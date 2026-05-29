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

const CYAN = new Color("#78d8d5");
const GREEN = new Color("#20d77a");
const GOLD = new Color("#e8c98d");

export default function NuomaAmbientScene() {
  const reducedMotion = usePrefersReducedMotion();

  if (reducedMotion) {
    return null;
  }

  return (
    <div className="nuoma-ambient-scene" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{
          alpha: true,
          antialias: false,
          powerPreference: "low-power",
        }}
      >
        <ambientLight intensity={0.55} />
        <pointLight position={[3, 4, 5]} intensity={9} color={CYAN} />
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
      Array.from({ length: 42 }, (_, index) => ({
        angle: index * 0.43,
        radius: 2.2 + (index % 9) * 0.24,
        y: ((index % 7) - 3) * 0.22,
        scale: 0.035 + (index % 4) * 0.012,
        color: index % 11 === 0 ? "#e8c98d" : index % 3 === 0 ? "#20d77a" : "#78d8d5",
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
            opacity={index % 5 === 0 ? 0.7 : 0.42}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.25, 0.012, 8, 96]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.11} blending={AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1.42, 1.42, 1]}>
        <torusGeometry args={[2.25, 0.008, 8, 96]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.08} blending={AdditiveBlending} />
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
        <meshBasicMaterial color={GREEN} transparent opacity={0.2} blending={AdditiveBlending} />
      </mesh>
      <mesh scale={[2.4, 2.4, 2.4]}>
        <icosahedronGeometry args={[0.48, 1]} />
        <meshBasicMaterial wireframe color={CYAN} transparent opacity={0.045} />
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
