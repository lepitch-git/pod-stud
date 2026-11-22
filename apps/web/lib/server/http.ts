import "server-only";

/**
 * Réponse d'erreur lisible : une page en français quand c'est un navigateur qui ouvre le lien
 * (clic sur « Télécharger »), du JSON pour les appels de l'application.
 */
export function errorResponse(req: Request, status: number, message: string): Response {
  const accept = req.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) return Response.json({ error: message }, { status });
  const esc = message.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Piste indisponible · Pod Stud</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf8;--fg:#1d1b19;--card:#fff;--ko:#b91c1c;--accent:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#161412;--fg:#f2efeb;--card:#1f1c19;--ko:#f87171;--accent:#fb923c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:40px 16px}
p.box{background:var(--card);border-left:4px solid var(--ko);padding:12px 16px;border-radius:6px}
a{color:var(--accent)}
</style></head><body><main>
<h1>Piste indisponible</h1>
<p class="box" data-testid="download-error">${esc}</p>
<p><a href="/enregistrement">Revenir à l'enregistrement</a></p>
</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
