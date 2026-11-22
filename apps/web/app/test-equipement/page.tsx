import type { Metadata } from "next";
import EquipmentTest from "./EquipmentTest";

export const metadata: Metadata = { title: "Test de l'équipement · Pod Stud" };

export default function Page() {
  return (
    <>
      <h1>Test de votre équipement</h1>
      <p className="lead">
        Quelques minutes pour vérifier micro, casque, caméra et connexion avant
        l&apos;enregistrement. Vous pouvez le faire dès réception de l&apos;invitation, la veille
        par exemple.
      </p>
      <EquipmentTest />
    </>
  );
}
