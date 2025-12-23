"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // code.ts
  var require_code = __commonJS({
    "code.ts"(exports) {
      function calculateDistance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
      }
      function pointToSegmentDistance(p, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq === 0) {
          return {
            distance: calculateDistance(p, a),
            t: 0,
            point: { x: a.x, y: a.y }
          };
        }
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));
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
      function findAndConnectEndpointsInFlattenedNode(node, maxDistance, noLimit, connectToSegment = false) {
        const vectorNetwork = node.vectorNetwork;
        let { vertices, segments, regions } = vectorNetwork;
        let currentVertices = vertices.map((v) => __spreadValues({}, v));
        let currentSegments = segments.map((s) => __spreadValues({}, s));
        let totalMerged = 0;
        let merged = true;
        while (merged) {
          merged = false;
          const connectionCount = /* @__PURE__ */ new Map();
          for (const segment of currentSegments) {
            connectionCount.set(segment.start, (connectionCount.get(segment.start) || 0) + 1);
            connectionCount.set(segment.end, (connectionCount.get(segment.end) || 0) + 1);
          }
          const endpointIndices = [];
          for (const [vertexIndex, count] of connectionCount.entries()) {
            if (count === 1) {
              endpointIndices.push(vertexIndex);
            }
          }
          if (endpointIndices.length === 0) {
            break;
          }
          const candidates = [];
          for (let i = 0; i < endpointIndices.length; i++) {
            for (let j = i + 1; j < endpointIndices.length; j++) {
              const idx1 = endpointIndices[i];
              const idx2 = endpointIndices[j];
              const v1 = currentVertices[idx1];
              const v2 = currentVertices[idx2];
              const sameSegment = currentSegments.some(
                (s) => s.start === idx1 && s.end === idx2 || s.start === idx2 && s.end === idx1
              );
              if (sameSegment)
                continue;
              const distance = calculateDistance(v1, v2);
              if (noLimit || distance <= maxDistance) {
                candidates.push({
                  type: "endpoint",
                  endpointIdx: idx1,
                  targetIdx: idx2,
                  distance
                });
              }
            }
          }
          if (connectToSegment) {
            for (const epIdx of endpointIndices) {
              const ep = currentVertices[epIdx];
              const connectedSegmentIdx = currentSegments.findIndex(
                (s) => s.start === epIdx || s.end === epIdx
              );
              for (let segIdx = 0; segIdx < currentSegments.length; segIdx++) {
                if (segIdx === connectedSegmentIdx)
                  continue;
                const seg = currentSegments[segIdx];
                const segStart = currentVertices[seg.start];
                const segEnd = currentVertices[seg.end];
                const result = pointToSegmentDistance(ep, segStart, segEnd);
                if (result.t > 0.05 && result.t < 0.95) {
                  if (noLimit || result.distance <= maxDistance) {
                    candidates.push({
                      type: "segment",
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
          candidates.sort((a, b) => a.distance - b.distance);
          if (candidates.length === 0) {
            break;
          }
          const best = candidates[0];
          if (best.type === "endpoint") {
            const keepIdx = Math.min(best.endpointIdx, best.targetIdx);
            const removeIdx = Math.max(best.endpointIdx, best.targetIdx);
            const v1 = currentVertices[keepIdx];
            const v2 = currentVertices[removeIdx];
            currentVertices[keepIdx] = __spreadProps(__spreadValues({}, v1), {
              x: (v1.x + v2.x) / 2,
              y: (v1.y + v2.y) / 2
            });
            for (const segment of currentSegments) {
              if (segment.start === removeIdx) {
                segment.start = keepIdx;
              }
              if (segment.end === removeIdx) {
                segment.end = keepIdx;
              }
            }
            currentVertices.splice(removeIdx, 1);
            for (const segment of currentSegments) {
              if (segment.start > removeIdx) {
                segment.start--;
              }
              if (segment.end > removeIdx) {
                segment.end--;
              }
            }
          } else {
            const epIdx = best.endpointIdx;
            const segIdx = best.targetIdx;
            const seg = currentSegments[segIdx];
            const splitPoint = best.splitPoint;
            currentVertices[epIdx] = __spreadProps(__spreadValues({}, currentVertices[epIdx]), {
              x: splitPoint.x,
              y: splitPoint.y
            });
            const originalEnd = seg.end;
            seg.end = epIdx;
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
        if (totalMerged > 0) {
          node.vectorNetwork = {
            vertices: currentVertices,
            segments: currentSegments,
            regions: regions ? [...regions] : []
          };
        }
        return totalMerged;
      }
      function disconnectBranchPoints(node) {
        const vectorNetwork = node.vectorNetwork;
        let { vertices, segments, regions } = vectorNetwork;
        let currentVertices = vertices.map((v) => __spreadValues({}, v));
        let currentSegments = segments.map((s) => __spreadValues({}, s));
        let totalDisconnected = 0;
        let disconnected = true;
        while (disconnected) {
          disconnected = false;
          const connectionCount = /* @__PURE__ */ new Map();
          const connectedSegments = /* @__PURE__ */ new Map();
          for (let segIdx = 0; segIdx < currentSegments.length; segIdx++) {
            const segment = currentSegments[segIdx];
            connectionCount.set(segment.start, (connectionCount.get(segment.start) || 0) + 1);
            connectionCount.set(segment.end, (connectionCount.get(segment.end) || 0) + 1);
            if (!connectedSegments.has(segment.start)) {
              connectedSegments.set(segment.start, []);
            }
            connectedSegments.get(segment.start).push(segIdx);
            if (!connectedSegments.has(segment.end)) {
              connectedSegments.set(segment.end, []);
            }
            connectedSegments.get(segment.end).push(segIdx);
          }
          let branchPointIdx = -1;
          for (const [vertexIndex, count] of connectionCount.entries()) {
            if (count >= 3) {
              branchPointIdx = vertexIndex;
              break;
            }
          }
          if (branchPointIdx === -1) {
            break;
          }
          const branchVertex = currentVertices[branchPointIdx];
          const segIndices = connectedSegments.get(branchPointIdx);
          for (let i = 1; i < segIndices.length; i++) {
            const segIdx = segIndices[i];
            const segment = currentSegments[segIdx];
            const newVertexIdx = currentVertices.length;
            currentVertices.push(__spreadProps(__spreadValues({}, branchVertex), {
              x: branchVertex.x,
              y: branchVertex.y
            }));
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
        if (totalDisconnected > 0) {
          node.vectorNetwork = {
            vertices: currentVertices,
            segments: currentSegments,
            regions: regions ? [...regions] : []
          };
        }
        return totalDisconnected;
      }
      function joinPaths(options) {
        return __async(this, null, function* () {
          const selection = figma.currentPage.selection;
          if (selection.length === 0) {
            return {
              success: false,
              count: 0,
              message: "\uBCA1\uD130\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694."
            };
          }
          if (selection.length < 2) {
            return {
              success: false,
              count: 0,
              message: "2\uAC1C \uC774\uC0C1\uC758 \uBCA1\uD130\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694."
            };
          }
          const validNodes = [];
          for (const node of selection) {
            if (node.type === "VECTOR" || node.type === "LINE" || node.type === "POLYGON" || node.type === "STAR" || node.type === "ELLIPSE" || node.type === "RECTANGLE" || node.type === "BOOLEAN_OPERATION") {
              validNodes.push(node);
            }
          }
          if (validNodes.length < 2) {
            return {
              success: false,
              count: 0,
              message: "\uBCA1\uD130 \uB178\uB4DC\uAC00 2\uAC1C \uC774\uC0C1 \uD544\uC694\uD569\uB2C8\uB2E4."
            };
          }
          try {
            const flattenedNode = figma.flatten(validNodes);
            const connectedCount = findAndConnectEndpointsInFlattenedNode(
              flattenedNode,
              options.maxDistance,
              options.noLimit,
              options.connectToSegment
            );
            figma.currentPage.selection = [flattenedNode];
            if (connectedCount === 0) {
              return {
                success: true,
                count: 0,
                message: "\uBCA1\uD130\uAC00 \uBCD1\uD569\uB418\uC5C8\uC9C0\uB9CC, \uC5F0\uACB0 \uAC00\uB2A5\uD55C \uB05D\uC810\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."
              };
            }
            return {
              success: true,
              count: connectedCount,
              message: `${connectedCount}\uAC1C\uC758 \uD328\uC2A4\uAC00 \uC5F0\uACB0\uB418\uC5C8\uC2B5\uB2C8\uB2E4!`
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958";
            return {
              success: false,
              count: 0,
              message: `\uC624\uB958 \uBC1C\uC0DD: ${errorMessage}`
            };
          }
        });
      }
      function getSelectedVectorCount() {
        const selection = figma.currentPage.selection;
        let count = 0;
        for (const node of selection) {
          if (node.type === "VECTOR" || node.type === "LINE" || node.type === "POLYGON" || node.type === "STAR" || node.type === "ELLIPSE" || node.type === "RECTANGLE" || node.type === "BOOLEAN_OPERATION") {
            count++;
          }
        }
        return count;
      }
      var debugFlattenedNode = null;
      figma.showUI(__html__, {
        width: 280,
        height: 400,
        themeColors: true
      });
      figma.ui.postMessage({
        type: "selection",
        count: getSelectedVectorCount()
      });
      figma.on("selectionchange", () => {
        figma.ui.postMessage({
          type: "selection",
          count: getSelectedVectorCount()
        });
      });
      figma.ui.onmessage = (msg) => __async(exports, null, function* () {
        if (msg.type === "join") {
          const options = {
            maxDistance: msg.maxDistance || 10,
            noLimit: msg.noLimit || false,
            connectToSegment: msg.connectToSegment || false,
            deleteOriginal: msg.deleteOriginal !== false
          };
          const result = yield joinPaths(options);
          figma.ui.postMessage({
            type: result.success ? "result" : "error",
            count: result.count,
            message: result.message
          });
          figma.notify(result.message, {
            timeout: 3e3,
            error: !result.success
          });
        }
        if (msg.type === "debug-flatten") {
          const selection = figma.currentPage.selection;
          const validNodes = [];
          for (const node of selection) {
            if (node.type === "VECTOR" || node.type === "LINE" || node.type === "POLYGON" || node.type === "STAR" || node.type === "ELLIPSE" || node.type === "RECTANGLE" || node.type === "BOOLEAN_OPERATION") {
              validNodes.push(node);
            }
          }
          if (validNodes.length < 2) {
            figma.ui.postMessage({ type: "debug-log", message: "\u274C \uBCA1\uD130 \uB178\uB4DC\uAC00 2\uAC1C \uC774\uC0C1 \uD544\uC694\uD569\uB2C8\uB2E4." });
            return;
          }
          try {
            debugFlattenedNode = figma.flatten(validNodes);
            figma.currentPage.selection = [debugFlattenedNode];
            const vn = debugFlattenedNode.vectorNetwork;
            figma.ui.postMessage({
              type: "debug-flatten-done",
              message: `\u2705 Flatten \uC644\uB8CC!
  - Vertices: ${vn.vertices.length}\uAC1C
  - Segments: ${vn.segments.length}\uAC1C`
            });
          } catch (error) {
            figma.ui.postMessage({ type: "debug-log", message: `\u274C Flatten \uC2E4\uD328: ${error}` });
          }
        }
        if (msg.type === "debug-analyze") {
          if (!debugFlattenedNode) {
            figma.ui.postMessage({ type: "debug-log", message: "\u274C \uBA3C\uC800 Flatten\uC744 \uC2E4\uD589\uD558\uC138\uC694." });
            return;
          }
          const vn = debugFlattenedNode.vectorNetwork;
          const connectionCount = /* @__PURE__ */ new Map();
          for (const segment of vn.segments) {
            connectionCount.set(segment.start, (connectionCount.get(segment.start) || 0) + 1);
            connectionCount.set(segment.end, (connectionCount.get(segment.end) || 0) + 1);
          }
          const endpoints = [];
          for (const [idx, count] of connectionCount.entries()) {
            if (count === 1) {
              endpoints.push(idx);
            }
          }
          let logMsg = `\u2705 \uB05D\uC810 \uBD84\uC11D \uC644\uB8CC!
`;
          logMsg += `  - \uCD1D Vertices: ${vn.vertices.length}\uAC1C
`;
          logMsg += `  - \uB05D\uC810 \uAC1C\uC218: ${endpoints.length}\uAC1C
`;
          logMsg += `  - \uB05D\uC810 \uC778\uB371\uC2A4: [${endpoints.join(", ")}]

`;
          logMsg += `\uB05D\uC810 \uC88C\uD45C:
`;
          for (const idx of endpoints) {
            const v = vn.vertices[idx];
            logMsg += `  [${idx}] (${v.x.toFixed(1)}, ${v.y.toFixed(1)})
`;
          }
          figma.ui.postMessage({ type: "debug-analyze-done", message: logMsg });
        }
        if (msg.type === "debug-merge") {
          if (!debugFlattenedNode) {
            figma.ui.postMessage({ type: "debug-log", message: "\u274C \uBA3C\uC800 Flatten\uC744 \uC2E4\uD589\uD558\uC138\uC694." });
            return;
          }
          const maxDistance = msg.maxDistance || 10;
          const noLimit = msg.noLimit || false;
          const connectToSegment = msg.connectToSegment || false;
          const vn = debugFlattenedNode.vectorNetwork;
          let logMsg = `\u{1F527} \uBCD1\uD569 \uC2DC\uC791...
`;
          logMsg += `  - \uBCD1\uD569 \uC804 Vertices: ${vn.vertices.length}\uAC1C
`;
          logMsg += `  - \uBCD1\uD569 \uC804 Segments: ${vn.segments.length}\uAC1C
`;
          logMsg += `  - \uC120\uBD84 \uC5F0\uACB0 \uBAA8\uB4DC: ${connectToSegment ? "ON" : "OFF"}
`;
          const mergedCount = findAndConnectEndpointsInFlattenedNode(
            debugFlattenedNode,
            maxDistance,
            noLimit,
            connectToSegment
          );
          const vnAfter = debugFlattenedNode.vectorNetwork;
          logMsg += `
\u2705 \uBCD1\uD569 \uC644\uB8CC!
`;
          logMsg += `  - \uBCD1\uD569\uB41C Vertex \uC30D: ${mergedCount}\uAC1C
`;
          logMsg += `  - \uBCD1\uD569 \uD6C4 Vertices: ${vnAfter.vertices.length}\uAC1C
`;
          logMsg += `  - \uBCD1\uD569 \uD6C4 Segments: ${vnAfter.segments.length}\uAC1C
`;
          if (mergedCount > 0) {
            logMsg += `
\u26A0\uFE0F vertex \uC774\uB3D9 \uD14C\uC2A4\uD2B8:
`;
            logMsg += `  \uBCA1\uD130 \uB354\uBE14\uD074\uB9AD \u2192 \uD3B8\uC9D1 \uBAA8\uB4DC \u2192 \uC810 \uC774\uB3D9\uD574\uBCF4\uC138\uC694`;
          }
          figma.ui.postMessage({ type: "debug-merge-done", message: logMsg });
        }
        if (msg.type === "disconnect") {
          const selection = figma.currentPage.selection;
          if (selection.length === 0) {
            figma.ui.postMessage({
              type: "error",
              message: "\uBCA1\uD130\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694."
            });
            figma.notify("\uBCA1\uD130\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694.", { timeout: 3e3, error: true });
            return;
          }
          let totalDisconnected = 0;
          for (const node of selection) {
            if (node.type === "VECTOR") {
              const count = disconnectBranchPoints(node);
              totalDisconnected += count;
            }
          }
          if (totalDisconnected === 0) {
            figma.ui.postMessage({
              type: "result",
              message: "\uBD84\uB9AC\uD560 \uBD84\uAE30\uC810\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. (\uC5F0\uACB0\uC774 3\uAC1C \uC774\uC0C1\uC778 vertex \uC5C6\uC74C)"
            });
            figma.notify("\uBD84\uB9AC\uD560 \uBD84\uAE30\uC810\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.", { timeout: 3e3 });
          } else {
            figma.ui.postMessage({
              type: "result",
              message: `${totalDisconnected}\uAC1C\uC758 \uBD84\uAE30\uC810\uC774 \uBD84\uB9AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!`
            });
            figma.notify(`${totalDisconnected}\uAC1C\uC758 \uBD84\uAE30\uC810\uC774 \uBD84\uB9AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!`, { timeout: 3e3 });
          }
        }
        if (msg.type === "cancel") {
          figma.closePlugin();
        }
      });
    }
  });
  require_code();
})();
