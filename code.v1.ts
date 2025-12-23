// 피그마 패스 연결 플러그인 - 메인 로직

// ============================================
// 타입 정의
// ============================================

interface Endpoint {
  nodeId: string;           // 원본 노드 ID (추적용)
  vertexIndex: number;      // vectorNetwork 내 vertex 인덱스
  x: number;                // 절대 좌표 X
  y: number;                // 절대 좌표 Y
}

interface EndpointPair {
  endpoint1: Endpoint;
  endpoint2: Endpoint;
  distance: number;
}

interface JoinOptions {
  maxDistance: number;      // 최대 연결 거리 (픽셀)
  noLimit: boolean;         // 거리 제한 없음
  deleteOriginal: boolean;  // 원본 삭제 여부
}

// ============================================
// 핵심 함수들
// ============================================

/**
 * VectorNetwork에서 끝점(endpoint)을 찾는 함수
 * 끝점: 하나의 segment에만 연결된 vertex
 */
function findEndpoints(
  vectorNetwork: VectorNetwork,
  nodeId: string,
  transform: Transform
): Endpoint[] {
  const { vertices, segments } = vectorNetwork;
  const endpoints: Endpoint[] = [];

  // 각 vertex가 몇 개의 segment에 연결되어 있는지 카운트
  const connectionCount = new Map<number, number>();

  for (const segment of segments) {
    const startIdx = segment.start;
    const endIdx = segment.end;

    connectionCount.set(startIdx, (connectionCount.get(startIdx) || 0) + 1);
    connectionCount.set(endIdx, (connectionCount.get(endIdx) || 0) + 1);
  }

  // segment가 1개만 연결된 vertex = 끝점
  for (const [vertexIndex, count] of connectionCount.entries()) {
    if (count === 1) {
      const vertex = vertices[vertexIndex];

      // 로컬 좌표를 절대 좌표로 변환
      const absoluteX = transform[0][0] * vertex.x + transform[0][1] * vertex.y + transform[0][2];
      const absoluteY = transform[1][0] * vertex.x + transform[1][1] * vertex.y + transform[1][2];

      endpoints.push({
        nodeId,
        vertexIndex,
        x: absoluteX,
        y: absoluteY
      });
    }
  }

  return endpoints;
}

/**
 * 유클리드 거리 계산
 */
function calculateDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 가장 가까운 끝점 쌍들을 찾는 함수
 * 서로 다른 노드의 끝점끼리만 연결
 */
function findClosestEndpointPairs(
  allEndpoints: Endpoint[],
  maxDistance: number,
  noLimit: boolean
): EndpointPair[] {
  const pairs: EndpointPair[] = [];

  for (let i = 0; i < allEndpoints.length; i++) {
    for (let j = i + 1; j < allEndpoints.length; j++) {
      const ep1 = allEndpoints[i];
      const ep2 = allEndpoints[j];

      // 같은 노드의 끝점은 건너뛰기
      if (ep1.nodeId === ep2.nodeId) continue;

      const distance = calculateDistance(ep1, ep2);

      // 거리 제한 체크
      if (noLimit || distance <= maxDistance) {
        pairs.push({
          endpoint1: ep1,
          endpoint2: ep2,
          distance
        });
      }
    }
  }

  // 거리순 정렬 (가까운 것부터)
  pairs.sort((a, b) => a.distance - b.distance);

  return pairs;
}

/**
 * flatten된 노드의 vectorNetwork에서 끝점을 찾고 연결하는 함수
 */
function findAndConnectEndpointsInFlattenedNode(
  node: VectorNode,
  maxDistance: number,
  noLimit: boolean
): number {
  const vectorNetwork = node.vectorNetwork;
  const { vertices, segments, regions } = vectorNetwork;

  // 각 vertex의 연결 수 카운트
  const connectionCount = new Map<number, number>();

  for (const segment of segments) {
    connectionCount.set(segment.start, (connectionCount.get(segment.start) || 0) + 1);
    connectionCount.set(segment.end, (connectionCount.get(segment.end) || 0) + 1);
  }

  // 끝점 찾기 (연결이 1개인 vertex)
  const endpointIndices: number[] = [];
  for (const [vertexIndex, count] of connectionCount.entries()) {
    if (count === 1) {
      endpointIndices.push(vertexIndex);
    }
  }

  if (endpointIndices.length < 2) {
    return 0; // 연결할 끝점이 부족
  }

  // 끝점 쌍 찾기 및 거리 계산
  const pairs: { idx1: number; idx2: number; distance: number }[] = [];

  for (let i = 0; i < endpointIndices.length; i++) {
    for (let j = i + 1; j < endpointIndices.length; j++) {
      const v1 = vertices[endpointIndices[i]];
      const v2 = vertices[endpointIndices[j]];
      const distance = calculateDistance(v1, v2);

      if (noLimit || distance <= maxDistance) {
        pairs.push({
          idx1: endpointIndices[i],
          idx2: endpointIndices[j],
          distance
        });
      }
    }
  }

  pairs.sort((a, b) => a.distance - b.distance);

  if (pairs.length === 0) {
    return 0;
  }

  // 새로운 segments 배열 생성
  const newSegments = [...segments];
  const usedEndpoints = new Set<number>();
  let connectedCount = 0;

  // 가장 가까운 쌍부터 연결 (이미 사용된 끝점은 제외)
  for (const pair of pairs) {
    if (usedEndpoints.has(pair.idx1) || usedEndpoints.has(pair.idx2)) {
      continue;
    }

    // 새 segment 추가 (직선으로 연결)
    newSegments.push({
      start: pair.idx1,
      end: pair.idx2,
      tangentStart: { x: 0, y: 0 },
      tangentEnd: { x: 0, y: 0 }
    });

    usedEndpoints.add(pair.idx1);
    usedEndpoints.add(pair.idx2);
    connectedCount++;
  }

  // 수정된 vectorNetwork 적용
  if (connectedCount > 0) {
    node.vectorNetwork = {
      vertices: [...vertices],
      segments: newSegments,
      regions: regions ? [...regions] : []
    };
  }

  return connectedCount;
}

/**
 * 선택된 노드들이 유효한 VectorNode인지 확인
 */
function getValidVectorNodes(nodes: readonly SceneNode[]): VectorNode[] {
  const vectorNodes: VectorNode[] = [];

  for (const node of nodes) {
    if (node.type === 'VECTOR') {
      vectorNodes.push(node);
    } else if (node.type === 'LINE' || node.type === 'POLYGON' ||
               node.type === 'STAR' || node.type === 'ELLIPSE' ||
               node.type === 'RECTANGLE') {
      // 이러한 노드들도 flatten 가능
      vectorNodes.push(node as unknown as VectorNode);
    }
  }

  return vectorNodes;
}

/**
 * 메인 패스 연결 함수
 */
async function joinPaths(options: JoinOptions): Promise<{ success: boolean; count: number; message: string }> {
  const selection = figma.currentPage.selection;

  // 1. 선택 검증
  if (selection.length === 0) {
    return {
      success: false,
      count: 0,
      message: '벡터를 선택해주세요.'
    };
  }

  if (selection.length < 2) {
    return {
      success: false,
      count: 0,
      message: '2개 이상의 벡터를 선택해주세요.'
    };
  }

  // 2. 선택된 노드들 중 벡터 노드만 필터링
  const validNodes: SceneNode[] = [];

  for (const node of selection) {
    // flatten 가능한 노드 타입들
    if (node.type === 'VECTOR' || node.type === 'LINE' ||
        node.type === 'POLYGON' || node.type === 'STAR' ||
        node.type === 'ELLIPSE' || node.type === 'RECTANGLE' ||
        node.type === 'BOOLEAN_OPERATION') {
      validNodes.push(node);
    }
  }

  if (validNodes.length < 2) {
    return {
      success: false,
      count: 0,
      message: '벡터 노드가 2개 이상 필요합니다.'
    };
  }

  try {
    // 3. 모든 노드를 하나의 VectorNode로 합침
    const flattenedNode = figma.flatten(validNodes as SceneNode[]);

    // 4. flatten된 노드에서 끝점 찾아 연결
    const connectedCount = findAndConnectEndpointsInFlattenedNode(
      flattenedNode,
      options.maxDistance,
      options.noLimit
    );

    // 5. 연결된 노드 선택
    figma.currentPage.selection = [flattenedNode];

    if (connectedCount === 0) {
      return {
        success: true,
        count: 0,
        message: '벡터가 병합되었지만, 연결 가능한 끝점이 없습니다.'
      };
    }

    return {
      success: true,
      count: connectedCount,
      message: `${connectedCount}개의 패스가 연결되었습니다!`
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
    return {
      success: false,
      count: 0,
      message: `오류 발생: ${errorMessage}`
    };
  }
}

/**
 * 선택된 벡터 노드 개수 반환
 */
function getSelectedVectorCount(): number {
  const selection = figma.currentPage.selection;
  let count = 0;

  for (const node of selection) {
    if (node.type === 'VECTOR' || node.type === 'LINE' ||
        node.type === 'POLYGON' || node.type === 'STAR' ||
        node.type === 'ELLIPSE' || node.type === 'RECTANGLE' ||
        node.type === 'BOOLEAN_OPERATION') {
      count++;
    }
  }

  return count;
}

// ============================================
// 플러그인 초기화 및 메시지 핸들링
// ============================================

// UI 표시
figma.showUI(__html__, {
  width: 280,
  height: 260,
  themeColors: true
});

// 초기 선택 상태 전송
figma.ui.postMessage({
  type: 'selection',
  count: getSelectedVectorCount()
});

// 선택 변경 감지
figma.on('selectionchange', () => {
  figma.ui.postMessage({
    type: 'selection',
    count: getSelectedVectorCount()
  });
});

// UI 메시지 핸들링
figma.ui.onmessage = async (msg: { type: string; maxDistance?: number; noLimit?: boolean; deleteOriginal?: boolean }) => {
  if (msg.type === 'join') {
    const options: JoinOptions = {
      maxDistance: msg.maxDistance || 10,
      noLimit: msg.noLimit || false,
      deleteOriginal: msg.deleteOriginal !== false
    };

    const result = await joinPaths(options);

    // 결과 전송
    figma.ui.postMessage({
      type: result.success ? 'result' : 'error',
      count: result.count,
      message: result.message
    });

    // 토스트 메시지
    figma.notify(result.message, {
      timeout: 3000,
      error: !result.success
    });
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
