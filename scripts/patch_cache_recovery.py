from pathlib import Path

BUILD = "2026-09-15-auth-cache-recovery-v1"
index_path = Path("index.html")
text = index_path.read_text(encoding="utf-8")

old_meta = '<meta name="atlas-build" content="2026-09-10-pulso-priority-balance-v1" />'
new_meta = f'<meta name="atlas-build" content="{BUILD}" />'
if old_meta in text:
    text = text.replace(old_meta, new_meta, 1)
elif 'name="atlas-build"' in text and BUILD not in text:
    import re
    text = re.sub(r'<meta name="atlas-build" content="[^"]+"\s*/>', new_meta, text, count=1)

marker = '<meta http-equiv="Expires" content="0" />'
cleanup_script = f'''{marker}\n    <script>\n      (() => {{\n        const build = '{BUILD}';\n        try {{\n          window.__ATLAS_BUILD__ = build;\n          window.addEventListener('load', () => {{\n            if ('serviceWorker' in navigator) {{\n              navigator.serviceWorker.getRegistrations()\n                .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))\n                .catch(() => undefined);\n            }}\n            if ('caches' in window) {{\n              caches.keys()\n                .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))\n                .catch(() => undefined);\n            }}\n          }}, {{ once: true }});\n        }} catch (_) {{\n          // La limpieza de caché nunca debe impedir que ATLAS cargue.\n        }}\n      }})();\n    </script>'''

if BUILD not in text.split('</script>', 1)[0]:
    if marker not in text:
        raise SystemExit('No se encontró el punto de inserción de recuperación de caché')
    text = text.replace(marker, cleanup_script, 1)

index_path.write_text(text, encoding="utf-8")

public = Path("public")
public.mkdir(exist_ok=True)
self_destruct = '''// ATLAS Observatorio — service worker de recuperación.
// Si una versión histórica registró un service worker, esta versión elimina
// sus caches y se desregistra para que el navegador vuelva a la app publicada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(windows.map((client) => client.navigate(client.url)));
    } catch (_) {}
  })());
});
'''
(public / "sw.js").write_text(self_destruct, encoding="utf-8")
(public / "service-worker.js").write_text(self_destruct, encoding="utf-8")

print(f"Cache recovery preparado: {BUILD}")
