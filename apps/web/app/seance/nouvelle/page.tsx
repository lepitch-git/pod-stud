"use client";

import { newTakeId } from "@pod-stud/shared";
import { useEffect } from "react";

/** Crée une séance d'essai et ouvre la place de l'hôte. */
export default function NewSession() {
  useEffect(() => {
    window.location.replace(`/seance/${newTakeId()}?hote=1`);
  }, []);
  return <p>Création de la séance…</p>;
}
