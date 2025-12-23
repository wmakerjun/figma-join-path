// 피그마 패스 연결 플러그인 - 메인 로직 (v2: vertex 병합 방식)

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
  connectToSegment: boolean; // 선분 위에도 연결
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
 * 점에서 선분까지의 최단 거리와 선분 위의 가장 가까운 점을 계산
 * @returns { distance: 최단거리, t: 선분 위 비율(0~1), point: 선분 위 가장 가까운 점 }
 */
function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): { distance: number; t: number; point: { x: number; y: number } } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  // a와 b가 같은 점인 경우
  if (lengthSq === 0) {
    return {
      distance: calculateDistance(p, a),
      t: 0,
      point: { x: a.x, y: a.y }
    };
  }

  // 선분 위에서 p에 가장 가까운 점의 비율 t (0~1 사이로 클램프)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  // 선분 위의 가장 가까운 점
  const closestPoint = {
    x: a.x + t * dx,
    y: a.y + t * dy
  };

  return {
    distance: calculateDistance(p, closestPoint),
    t,
    point: closestPoint
  };
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

// 연결 후보 타입: 끝점-끝점 또는 끝점-선분
interface ConnectionCandidate {
  type: 'endpoint' | 'segment';
  endpointIdx: number;      // 연결할 끝점 인덱스
  targetIdx: number;        // 끝점-끝점: 대상 끝점 인덱스, 끝점-선분: 세그먼트 인덱스
  distance: number;
  t?: number;               // 끝점-선분: 선분 위 비율 (0~1)
  splitPoint?: { x: number; y: number };  // 끝점-선분: 분할 지점 좌표
}

/**
 * flatten된 노드의 vectorNetwork에서 끝점을 찾고 병합하는 함수 (v2)
 * v1과 다르게 segment로 연결하는 것이 아니라 vertex 자체를 병합함
 * 이렇게 하면 vertex를 이동할 때 연결된 패스가 함께 움직임
 *
 * connectToSegment가 true이면 끝점-선분 연결도 수행
 */
function findAndConnectEndpointsInFlattenedNode(
  node: VectorNode,
  maxDistance: number,
  noLimit: boolean,
  connectToSegment: boolean = false
): number {
  const vectorNetwork = node.vectorNetwork;
  let { vertices, segments, regions } = vectorNetwork;

  // vertices와 segments를 수정 가능하도록 복사
  let currentVertices = vertices.map(v => ({ ...v }));
  let currentSegments = segments.map(s => ({ ...s }));

  let totalMerged = 0;

  // 반복적으로 병합 수행 (한 번에 하나씩 병합하고 다시 끝점 탐색)
  let merged = true;
  while (merged) {
    merged = false;

    // 각 vertex의 연결 수 카운트
    const connectionCount = new Map<number, number>();

    for (const segment of currentSegments) {
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

    if (endpointIndices.length === 0) {
      break; // 연결할 끝점이 없음
    }

    // 모든 연결 후보 수집
    const candidates: ConnectionCandidate[] = [];

    // 1. 끝점-끝점 후보 찾기
    for (let i = 0; i < endpointIndices.length; i++) {
      for (let j = i + 1; j < endpointIndices.length; j++) {
        const idx1 = endpointIndices[i];
        const idx2 = endpointIndices[j];
        const v1 = currentVertices[idx1];
        const v2 = currentVertices[idx2];

        // 같은 segment의 양 끝점인지 확인
        const sameSegment = currentSegments.some(s =>
          (s.start === idx1 && s.end === idx2) ||
          (s.start === idx2 && s.end === idx1)
        );
        if (sameSegment) continue;

        const distance = calculateDistance(v1, v2);

        if (noLimit || distance <= maxDistance) {
          candidates.push({
            type: 'endpoint',
            endpointIdx: idx1,
            targetIdx: idx2,
            distance
          });
        }
      }
    }

    // 2. 끝점-선분 후보 찾기 (connectToSegment가 true일 때만)
    if (connectToSegment) {
      for (const epIdx of endpointIndices) {
        const ep = currentVertices[epIdx];

        // 끝점이 연결된 세그먼트 찾기
        const connectedSegmentIdx = currentSegments.findIndex(s =>
          s.start === epIdx || s.end === epIdx
        );

        for (let segIdx = 0; segIdx < currentSegments.length; segIdx++) {
          // 자신이 연결된 세그먼트는 제외
          if (segIdx === connectedSegmentIdx) continue;

          const seg = currentSegments[segIdx];
          const segStart = currentVertices[seg.start];
          const segEnd = currentVertices[seg.end];

          // 끝점에서 선분까지 거리 계산
          const result = pointToSegmentDistance(ep, segStart, segEnd);

          // 선분의 끝점 근처(t가 0.05~0.95 사이)인 경우만 선분 연결로 처리
          // 끝점 근처라면 끝점-끝점 연결로 처리됨
          if (result.t > 0.05 && result.t < 0.95) {
            if (noLimit || result.distance <= maxDistance) {
              candidates.push({
                type: 'segment',
                endpointIdx: epIdx,
                targetIdx: segIdx,
                distance: result.distance,
                t: result.t,
                splitPoint: result.point
              });
            }
          }
        }
      }
    }

    // 거리순 정렬
    candidates.sort((a, b) => a.distance - b.distance);

    if (candidates.length === 0) {
      break;
    }

    const best = candidates[0];

    if (best.type === 'endpoint') {
      // 끝점-끝점 병합
      const keepIdx = Math.min(best.endpointIdx, best.targetIdx);
      const removeIdx = Math.max(best.endpointIdx, best.targetIdx);

      // 병합될 vertex의 좌표를 중간점으로 이동
      const v1 = currentVertices[keepIdx];
      const v2 = currentVertices[removeIdx];
      currentVertices[keepIdx] = {
        ...v1,
        x: (v1.x + v2.x) / 2,
        y: (v1.y + v2.y) / 2
      };

      // removeIdx를 참조하는 모든 segment를 keepIdx로 변경
      for (const segment of currentSegments) {
        if (segment.start === removeIdx) {
          segment.start = keepIdx;
        }
        if (segment.end === removeIdx) {
          segment.end = keepIdx;
        }
      }

      // removeIdx를 vertices에서 제거
      currentVertices.splice(removeIdx, 1);

      // removeIdx보다 큰 인덱스를 가진 segment 참조들을 -1 조정
      for (const segment of currentSegments) {
        if (segment.start > removeIdx) {
          segment.start--;
        }
        if (segment.end > removeIdx) {
          segment.end--;
        }
      }
    } else {
      // 끝점-선분 병합: 선분을 분할하고 끝점을 분할점에 병합
      const epIdx = best.endpointIdx;
      const segIdx = best.targetIdx;
      const seg = currentSegments[segIdx];
      const splitPoint = best.splitPoint!;

      // 1. 분할점에 새 vertex 삽입 (끝점의 위치를 분할점으로 이동)
      currentVertices[epIdx] = {
        ...currentVertices[epIdx],
        x: splitPoint.x,
        y: splitPoint.y
      };

      // 2. 원래 선분을 두 개로 분할
      // 원래: seg.start --- seg.end
      // 분할 후: seg.start --- epIdx, epIdx --- seg.end

      const originalEnd = seg.end;
      seg.end = epIdx;  // 첫 번째 선분

      // 두 번째 선분 추가
      currentSegments.push({
        start: epIdx,
        end: originalEnd,
        tangentStart: { x: 0, y: 0 },
        tangentEnd: { x: 0, y: 0 }
      });
    }

    merged = true;
    totalMerged++;
  }

  // 수정된 vectorNetwork 적용
  if (totalMerged > 0) {
    node.vectorNetwork = {
      vertices: currentVertices,
      segments: currentSegments,
      regions: regions ? [...regions] : []
    };
  }

  return totalMerged;
}

/**
 * 분기점(3개 이상의 segment에 연결된 vertex)을 분리하는 함수
 * 연결 해제: 병합의 반대 작업
 *
 * @returns 분리된 vertex 수
 */
function disconnectBranchPoints(node: VectorNode): number {
  const vectorNetwork = node.vectorNetwork;
  let { vertices, segments, regions } = vectorNetwork;

  // vertices와 segments를 수정 가능하도록 복사
  let currentVertices = vertices.map(v => ({ ...v }));
  let currentSegments = segments.map(s => ({ ...s }));

  let totalDisconnected = 0;

  // 반복적으로 분리 수행
  let disconnected = true;
  while (disconnected) {
    disconnected = false;

    // 각 vertex의 연결 수 카운트
    const connectionCount = new Map<number, number>();
    const connectedSegments = new Map<number, number[]>(); // vertex -> segment indices

    for (let segIdx = 0; segIdx < currentSegments.length; segIdx++) {
      const segment = currentSegments[segIdx];

      connectionCount.set(segment.start, (connectionCount.get(segment.start) || 0) + 1);
      connectionCount.set(segment.end, (connectionCount.get(segment.end) || 0) + 1);

      // 각 vertex에 연결된 segment 인덱스 저장
      if (!connectedSegments.has(segment.start)) {
        connectedSegments.set(segment.start, []);
      }
      connectedSegments.get(segment.start)!.push(segIdx);

      if (!connectedSegments.has(segment.end)) {
        connectedSegments.set(segment.end, []);
      }
      connectedSegments.get(segment.end)!.push(segIdx);
    }

    // 분기점 찾기 (연결이 3개 이상인 vertex)
    let branchPointIdx = -1;
    for (const [vertexIndex, count] of connectionCount.entries()) {
      if (count >= 3) {
        branchPointIdx = vertexIndex;
        break;
      }
    }

    if (branchPointIdx === -1) {
      break; // 분기점이 없음
    }

    // 분기점을 분리
    const branchVertex = currentVertices[branchPointIdx];
    const segIndices = connectedSegments.get(branchPointIdx)!;

    // 첫 번째 segment는 그대로 두고, 나머지 segment들에 대해 새 vertex 생성
    for (let i = 1; i < segIndices.length; i++) {
      const segIdx = segIndices[i];
      const segment = currentSegments[segIdx];

      // 새 vertex 추가 (같은 좌표)
      const newVertexIdx = currentVertices.length;
      currentVertices.push({
        ...branchVertex,
        x: branchVertex.x,
        y: branchVertex.y
      });

      // segment의 참조 업데이트
      if (segment.start === branchPointIdx) {
        segment.start = newVertexIdx;
      }
      if (segment.end === branchPointIdx) {
        segment.end = newVertexIdx;
      }
    }

    disconnected = true;
    totalDisconnected++;
  }

  // 수정된 vectorNetwork 적용
  if (totalDisconnected > 0) {
    node.vectorNetwork = {
      vertices: currentVertices,
      segments: currentSegments,
      regions: regions ? [...regions] : []
    };
  }

  return totalDisconnected;
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
      options.noLimit,
      options.connectToSegment
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

// 디버그용 상태 저장
let debugFlattenedNode: VectorNode | null = null;

// UI 표시
figma.showUI(__html__, {
  width: 280,
  height: 400,
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
figma.ui.onmessage = async (msg: { type: string; maxDistance?: number; noLimit?: boolean; connectToSegment?: boolean; deleteOriginal?: boolean }) => {
  if (msg.type === 'join') {
    const options: JoinOptions = {
      maxDistance: msg.maxDistance || 10,
      noLimit: msg.noLimit || false,
      connectToSegment: msg.connectToSegment || false,
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

  // 디버그: Step 1 - Flatten만
  if (msg.type === 'debug-flatten') {
    const selection = figma.currentPage.selection;
    const validNodes: SceneNode[] = [];

    for (const node of selection) {
      if (node.type === 'VECTOR' || node.type === 'LINE' ||
          node.type === 'POLYGON' || node.type === 'STAR' ||
          node.type === 'ELLIPSE' || node.type === 'RECTANGLE' ||
          node.type === 'BOOLEAN_OPERATION') {
        validNodes.push(node);
      }
    }

    if (validNodes.length < 2) {
      figma.ui.postMessage({ type: 'debug-log', message: '❌ 벡터 노드가 2개 이상 필요합니다.' });
      return;
    }

    try {
      debugFlattenedNode = figma.flatten(validNodes as SceneNode[]);
      figma.currentPage.selection = [debugFlattenedNode];

      const vn = debugFlattenedNode.vectorNetwork;
      figma.ui.postMessage({
        type: 'debug-flatten-done',
        message: `✅ Flatten 완료!\n  - Vertices: ${vn.vertices.length}개\n  - Segments: ${vn.segments.length}개`
      });
    } catch (error) {
      figma.ui.postMessage({ type: 'debug-log', message: `❌ Flatten 실패: ${error}` });
    }
  }

  // 디버그: Step 2 - 끝점 분석
  if (msg.type === 'debug-analyze') {
    if (!debugFlattenedNode) {
      figma.ui.postMessage({ type: 'debug-log', message: '❌ 먼저 Flatten을 실행하세요.' });
      return;
    }

    const vn = debugFlattenedNode.vectorNetwork;
    const connectionCount = new Map<number, number>();

    for (const segment of vn.segments) {
      connectionCount.set(segment.start, (connectionCount.get(segment.start) || 0) + 1);
      connectionCount.set(segment.end, (connectionCount.get(segment.end) || 0) + 1);
    }

    const endpoints: number[] = [];
    for (const [idx, count] of connectionCount.entries()) {
      if (count === 1) {
        endpoints.push(idx);
      }
    }

    let logMsg = `✅ 끝점 분석 완료!\n`;
    logMsg += `  - 총 Vertices: ${vn.vertices.length}개\n`;
    logMsg += `  - 끝점 개수: ${endpoints.length}개\n`;
    logMsg += `  - 끝점 인덱스: [${endpoints.join(', ')}]\n\n`;

    // 끝점 좌표 표시
    logMsg += `끝점 좌표:\n`;
    for (const idx of endpoints) {
      const v = vn.vertices[idx];
      logMsg += `  [${idx}] (${v.x.toFixed(1)}, ${v.y.toFixed(1)})\n`;
    }

    figma.ui.postMessage({ type: 'debug-analyze-done', message: logMsg });
  }

  // 디버그: Step 3 - Vertex 병합
  if (msg.type === 'debug-merge') {
    if (!debugFlattenedNode) {
      figma.ui.postMessage({ type: 'debug-log', message: '❌ 먼저 Flatten을 실행하세요.' });
      return;
    }

    const maxDistance = msg.maxDistance || 10;
    const noLimit = msg.noLimit || false;
    const connectToSegment = msg.connectToSegment || false;

    const vn = debugFlattenedNode.vectorNetwork;
    let logMsg = `🔧 병합 시작...\n`;
    logMsg += `  - 병합 전 Vertices: ${vn.vertices.length}개\n`;
    logMsg += `  - 병합 전 Segments: ${vn.segments.length}개\n`;
    logMsg += `  - 선분 연결 모드: ${connectToSegment ? 'ON' : 'OFF'}\n`;

    const mergedCount = findAndConnectEndpointsInFlattenedNode(
      debugFlattenedNode,
      maxDistance,
      noLimit,
      connectToSegment
    );

    const vnAfter = debugFlattenedNode.vectorNetwork;
    logMsg += `\n✅ 병합 완료!\n`;
    logMsg += `  - 병합된 Vertex 쌍: ${mergedCount}개\n`;
    logMsg += `  - 병합 후 Vertices: ${vnAfter.vertices.length}개\n`;
    logMsg += `  - 병합 후 Segments: ${vnAfter.segments.length}개\n`;

    if (mergedCount > 0) {
      logMsg += `\n⚠️ vertex 이동 테스트:\n`;
      logMsg += `  벡터 더블클릭 → 편집 모드 → 점 이동해보세요`;
    }

    figma.ui.postMessage({ type: 'debug-merge-done', message: logMsg });
  }

  // 연결 해제
  if (msg.type === 'disconnect') {
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      figma.ui.postMessage({
        type: 'error',
        message: '벡터를 선택해주세요.'
      });
      figma.notify('벡터를 선택해주세요.', { timeout: 3000, error: true });
      return;
    }

    let totalDisconnected = 0;

    for (const node of selection) {
      if (node.type === 'VECTOR') {
        const count = disconnectBranchPoints(node);
        totalDisconnected += count;
      }
    }

    if (totalDisconnected === 0) {
      figma.ui.postMessage({
        type: 'result',
        message: '분리할 분기점이 없습니다. (연결이 3개 이상인 vertex 없음)'
      });
      figma.notify('분리할 분기점이 없습니다.', { timeout: 3000 });
    } else {
      figma.ui.postMessage({
        type: 'result',
        message: `${totalDisconnected}개의 분기점이 분리되었습니다!`
      });
      figma.notify(`${totalDisconnected}개의 분기점이 분리되었습니다!`, { timeout: 3000 });
    }
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
