Deno.serve(async () => {
  const r = await fetch(Deno.env.get('APPS_SCRIPT_URL')!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: Deno.env.get('APPS_SCRIPT_TOKEN'),
      accion: 'ping',
    }),
  });
  return new Response(await r.text(), {
    headers: { 'Content-Type': 'application/json' },
  });
});