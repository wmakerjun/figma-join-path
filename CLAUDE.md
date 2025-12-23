# Figma Join Paths Plugin

## 프로젝트 개요
피그마에서 끊어진 벡터 패스들을 일러스트레이터의 Cmd+J처럼 자동으로 연결해주는 플러그인

## 기술 스택
- Figma Plugin API
- TypeScript
- esbuild (번들링)

## 핵심 개념
- `vectorNetwork`: 피그마의 벡터 데이터 구조. vertices(꼭짓점)와 segments(선분)로 구성
- 끝점(endpoint): 하나의 segment에만 연결된 vertex
- 연결 로직: 가장 가까운 끝점 쌍을 찾아 새 segment로 연결

## 디렉토리 구조
```
figma-join-paths/
├── manifest.json       # 플러그인 설정
├── code.ts            # 메인 로직 (TypeScript)
├── code.js            # 빌드된 메인 로직
├── ui.html            # UI (옵션 설정용)
├── package.json
├── tsconfig.json
└── CLAUDE.md          # 이 파일
```

## 주요 API 참고
- `figma.currentPage.selection`: 선택된 노드들
- `node.vectorNetwork`: vertices, segments, regions 포함
- `figma.flatten()`: 여러 벡터를 하나로 합침
- `node.vectorNetwork = { vertices, segments, regions }`: 벡터 네트워크 수정

## 제약사항
- vectorNetwork는 VectorNode에서만 접근 가능
- Group이나 Frame 내부의 벡터는 개별 처리 필요
- 좌표는 노드 로컬 좌표계 기준

## 빌드 명령어
```bash
npm install     # 의존성 설치
npm run build   # 빌드
npm run watch   # 개발 모드 (파일 변경 감지)
```

## 피그마에서 플러그인 로드하기
1. 피그마 데스크톱 앱 열기
2. Plugins → Development → Import plugin from manifest...
3. 이 폴더의 `manifest.json` 선택
4. 플러그인 실행: Plugins → Development → 패스 연결 (Join Paths)
