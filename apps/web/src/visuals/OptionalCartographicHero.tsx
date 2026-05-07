import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";

type HealthSignal = "active" | "idle" | "error" | "degraded";

interface OptionalCartographicHeroProps {
  healthLabel: string;
  healthSignal: HealthSignal;
  cdpConnected: boolean;
  workersOnline: number;
  workersTotal: number;
  queueDepth: number;
  dlqCount: number;
  throughputPerHour: number;
  failureRatePct: number;
}

interface BarDatum {
  key: string;
  label: string;
  value: string;
  x: number;
  z: number;
  height: number;
  color: string;
}

const SIGNAL_COLORS: Record<HealthSignal, string> = {
  active: "#82caa4",
  idle: "#8fb5d8",
  degraded: "#cdb36e",
  error: "#ce7287",
};

export default function OptionalCartographicHero({
  healthLabel,
  healthSignal,
  cdpConnected,
  workersOnline,
  workersTotal,
  queueDepth,
  dlqCount,
  throughputPerHour,
  failureRatePct,
}: OptionalCartographicHeroProps) {
  const bars = useMemo<BarDatum[]>(
    () => [
      {
        key: "cdp",
        label: "CDP",
        value: cdpConnected ? "online" : "off",
        x: -2.4,
        z: -0.9,
        height: cdpConnected ? 1.45 : 0.46,
        color: cdpConnected ? "#82caa4" : "#cdb36e",
      },
      {
        key: "workers",
        label: "Workers",
        value: `${workersOnline}/${workersTotal}`,
        x: -1.2,
        z: 0.35,
        height: scaleRatio(workersOnline, Math.max(1, workersTotal), 0.42, 1.65),
        color: "#8fb5d8",
      },
      {
        key: "queue",
        label: "Fila",
        value: String(queueDepth),
        x: 0,
        z: -0.25,
        height: scaleCount(queueDepth, 0.34, 1.7),
        color: queueDepth > 0 ? "#cdb36e" : "#82caa4",
      },
      {
        key: "throughput",
        label: "Throughput",
        value: `${throughputPerHour}/h`,
        x: 1.2,
        z: 0.48,
        height: scaleCount(throughputPerHour, 0.4, 1.8),
        color: "#8c8ec0",
      },
      {
        key: "dlq",
        label: "DLQ",
        value: String(dlqCount),
        x: 2.4,
        z: -0.78,
        height: dlqCount > 0 ? scaleCount(dlqCount + 2, 0.55, 1.85) : 0.28,
        color: dlqCount > 0 || failureRatePct > 0 ? "#ce7287" : "#82caa4",
      },
    ],
    [
      cdpConnected,
      dlqCount,
      failureRatePct,
      queueDepth,
      throughputPerHour,
      workersOnline,
      workersTotal,
    ],
  );
  const signalColor = SIGNAL_COLORS[healthSignal];

  return (
    <section
      className="relative isolate min-h-[18rem] overflow-hidden rounded-xl border border-border-subtle/10 bg-bg-sunken shadow-raised-lg"
      data-testid="v214a-cartographic-hero"
      data-status={healthSignal}
      data-enabled="true"
    >
      <div
        className="absolute inset-0 z-0"
        data-testid="v214a-cartographic-canvas"
        aria-hidden="true"
      >
        <Canvas
          camera={{ position: [0, 2.45, 6.6], fov: 42 }}
          className="h-full w-full"
          dpr={[1, 1.6]}
          gl={{
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true,
            powerPreference: "high-performance",
          }}
        >
          <color attach="background" args={["#03060d"]} />
          <ambientLight intensity={0.46} />
          <directionalLight position={[3, 4, 4]} intensity={2.2} color="#d7e8ff" />
          <pointLight position={[-4, 2.2, 2.8]} intensity={8.5} color={signalColor} />
          <CartographicScene bars={bars} signalColor={signalColor} />
        </Canvas>
      </div>

      <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_72%_36%,rgba(143,181,216,0.10),transparent_34%),linear-gradient(90deg,rgba(5,7,13,0.88),rgba(5,7,13,0.34)_58%,rgba(5,7,13,0.72))]" />

      <div className="pointer-events-none relative z-10 flex min-h-[18rem] flex-col justify-between gap-6 p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-fg-dim">
              V2.14a · Visual opcional
            </p>
            <h2 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight tracking-normal text-fg-primary md:text-5xl">
              Mapa vivo da operação local-first.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-fg-muted">
              API, CDP, workers, fila e DLQ aparecem como relevo operacional sem alterar os
              guardrails de envio.
            </p>
          </div>
          <div
            className="rounded-lg bg-bg-base/70 px-3 py-2 text-right shadow-flat"
            data-testid="v214a-hero-status"
            data-signal={healthSignal}
          >
            <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-fg-dim">
              status
            </div>
            <div className="mt-1 text-sm font-semibold text-fg-primary">{healthLabel}</div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-5" data-testid="v214a-hero-metrics">
          {bars.map((bar) => (
            <div key={bar.key} className="rounded-lg bg-bg-base/62 px-3 py-2 shadow-flat">
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-fg-dim">
                {bar.label}
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-fg-primary">
                {bar.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CartographicScene({ bars, signalColor }: { bars: BarDatum[]; signalColor: string }) {
  const rootRef = useRef<Group>(null);
  const ringRef = useRef<Group>(null);
  const sweepRef = useRef<Group>(null);

  useFrame((state, delta) => {
    const elapsed = state.clock.elapsedTime;
    if (rootRef.current) {
      rootRef.current.rotation.x = -0.32 + state.pointer.y * 0.035;
      rootRef.current.rotation.y = Math.sin(elapsed * 0.24) * 0.16 + state.pointer.x * 0.08;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.18;
    }
    if (sweepRef.current) {
      sweepRef.current.rotation.z -= delta * 0.34;
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.72, 0]} rotation={[-0.32, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
        <planeGeometry args={[7.6, 4.8, 22, 14]} />
        <meshStandardMaterial
          color="#101725"
          metalness={0.28}
          roughness={0.5}
          wireframe
          emissive="#25354d"
          emissiveIntensity={0.3}
        />
      </mesh>
      <gridHelper args={[8.4, 18, "#8fb5d8", "#27364f"]} position={[0, -0.035, 0]} />

      <group position={[0, 0, 0]}>
        {bars.map((bar) => (
          <group key={bar.key} position={[bar.x, bar.height / 2, bar.z]}>
            <mesh>
              <boxGeometry args={[0.36, bar.height, 0.36]} />
              <meshStandardMaterial
                color={bar.color}
                emissive={bar.color}
                emissiveIntensity={0.34}
                metalness={0.16}
                roughness={0.42}
              />
            </mesh>
            <mesh position={[0, bar.height / 2 + 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.28, 0.012, 8, 36]} />
              <meshBasicMaterial color={bar.color} transparent opacity={0.78} />
            </mesh>
          </group>
        ))}
      </group>

      <group ref={ringRef} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <mesh>
          <torusGeometry args={[3.25, 0.012, 8, 112]} />
          <meshBasicMaterial color={signalColor} transparent opacity={0.58} />
        </mesh>
        <mesh>
          <torusGeometry args={[2.18, 0.008, 8, 96]} />
          <meshBasicMaterial color="#8fb5d8" transparent opacity={0.34} />
        </mesh>
      </group>

      <group ref={sweepRef} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.09, 0]}>
        <mesh position={[1.58, 0, 0]}>
          <boxGeometry args={[2.8, 0.018, 0.018]} />
          <meshBasicMaterial color={signalColor} transparent opacity={0.62} />
        </mesh>
      </group>
    </group>
  );
}

function scaleRatio(value: number, max: number, min: number, maxHeight: number) {
  const ratio = Math.max(0, Math.min(1, value / max));
  return min + ratio * (maxHeight - min);
}

function scaleCount(value: number, min: number, max: number) {
  if (value <= 0) return min;
  const ratio = Math.min(1, Math.log10(value + 1) / 2);
  return min + ratio * (max - min);
}
