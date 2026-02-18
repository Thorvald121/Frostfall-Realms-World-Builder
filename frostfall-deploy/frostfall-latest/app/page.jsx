"use client";
import AuthGate from "../components/AuthGate";
import FrostfallRealms from "../components/FrostfallRealms";

export default function Home() {
  return (
    <AuthGate>
      {({ user, onLogout }) => (
        <FrostfallRealms user={user} onLogout={onLogout} />
      )}
    </AuthGate>
  );
}
