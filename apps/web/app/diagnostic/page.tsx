import type { Metadata } from "next";
import DiagnosticView from "./DiagnosticView";

export const metadata: Metadata = { title: "Diagnostic navigateur · Pod Stud" };

export default function DiagnosticPage() {
  return (
    <>
      <h1>Diagnostic du navigateur</h1>
      <p className="lead">
        Cette page vérifie, sans rien enregistrer ni demander l&apos;accès au micro, que votre
        navigateur a tout ce qu&apos;il faut pour enregistrer une session.
      </p>
      <DiagnosticView />
    </>
  );
}
