import * as THREE from 'three';
export const shared = {
  uDay: { value: 1 }, uOvercast: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 },
  uLampMap: { value: null as THREE.Texture | null }, uLampScale: { value: new THREE.Vector2(1, 0) }, // uv = (xz + radius) / (n·cell)
  uCarPos: { value: new THREE.Vector3() }, uCarDir: { value: new THREE.Vector2(0, -1) }, uSkyColour: { value: new THREE.Color() },
};
