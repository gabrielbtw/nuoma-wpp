import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { AdditiveBlending, Color } from "three";

interface AmbientNode {
  angle: number;
  radius: number;
  y: number;
  scale: number;
  color: string;
}

const TEAL = new Color("#5b9bad");
const GREEN = new Color("#23a866");
const BLUE_SOFT = new Color("#a8c7d8");

interface NuomaAmbientSceneProps {
  className?: string;
  testId?: string;
}

export default function NuomaAmbientScene({
  className = "nuoma-ambient-scene",
  testId = "nuoma-ambient-scene",
}: NuomaAmbientSceneProps) {
  const reducedMotion = usePrefersReducedMotion();
  const webGlAvailable = useWebGlAvailable();

  if (reducedMotion || !webGlAvailable) {
    return null;
  }

  return (
    <div className={className} data-testid={testId} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 42 }}
        dpr={[1, 1.25]}
        fallback={null}
        gl={{
          alpha: true,
          antialias: false,
          preserveDrawingBuffer: true,
          powerPreference: "low-power",
        }}
      >
        <ambientLight intensity={0.55} />
        <pointLight position={[3, 4, 5]} intensity={9} color={TEAL} />
        <OperationsLattice />
        <SessionOrbit />
      </Canvas>
    </div>
  );
}

function OperationsLattice() {
  const groupRef = useRef<Group>(null);
  const nodes = useMemo<AmbientNode[]>(
    () =>
      Array.from({ length: 84 }, (_, index) => ({
        angle: index * 0.43,
        radius: 2.2 + (index % 9) * 0.24,
        y: ((index % 7) - 3) * 0.22,
        scale: 0.075 + (index % 4) * 0.021,
        color: index % 11 === 0 ? "#a8c7d8" : index % 3 === 0 ? "#23a866" : "#5b9bad",
      })),
    [],
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    group.rotation.z += delta * 0.025;
    group.rotation.x = Math.sin(state.clock.elapsedTime * 0.18) * 0.08;
  });

  return (
    <group ref={groupRef} position={[3.75, -0.25, -4]} rotation={[0.2, -0.38, -0.18]}>
      {nodes.map((node, index) => (
        <mesh
          key={index}
          position={[
            Math.cos(node.angle) * node.radius,
            node.y,
            Math.sin(node.angle) * node.radius * 0.28,
          ]}
          scale={node.scale}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color={node.color}
            transparent
            opacity={index % 5 === 0 ? 0.82 : 0.58}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.25, 0.012, 8, 96]} />
        <meshBasicMaterial color={TEAL} transparent opacity={0.18} blending={AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1.42, 1.42, 1]}>
        <torusGeometry args={[2.25, 0.008, 8, 96]} />
        <meshBasicMaterial
          color={BLUE_SOFT}
          transparent
          opacity={0.12}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function SessionOrbit() {
  const meshRef = useRef<Mesh>(null);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.rotation.z -= delta * 0.04;
    mesh.position.y = Math.sin(state.clock.elapsedTime * 0.35) * 0.06;
  });

  return (
    <group position={[-4.15, 2.5, -5.5]} rotation={[0.18, 0.24, -0.48]}>
      <mesh ref={meshRef}>
        <torusKnotGeometry args={[0.72, 0.018, 96, 8]} />
        <meshBasicMaterial color={GREEN} transparent opacity={0.28} blending={AdditiveBlending} />
      </mesh>
      <mesh scale={[2.4, 2.4, 2.4]}>
        <icosahedronGeometry args={[0.48, 1]} />
        <meshBasicMaterial wireframe color={TEAL} transparent opacity={0.08} />
      </mesh>
    </group>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function useWebGlAvailable() {
  const [available, setAvailable] = useState(() => {
    if (typeof document === "undefined") return false;
    return canCreateWebGlContext();
  });

  useEffect(() => {
    setAvailable(canCreateWebGlContext());
  }, []);

  return available;
}

function canCreateWebGlContext() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
