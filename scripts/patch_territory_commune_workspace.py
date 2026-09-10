from pathlib import Path

path = Path('src/views/Territorio.tsx')
text = path.read_text(encoding='utf-8')

replacements = {
    "import { useEffect, useMemo, useState } from 'react';": "import { useMemo, useState } from 'react';",
    "import { Bars, Meter, OrderedDistribution } from '../components/charts';": "import { Meter, OrderedDistribution } from '../components/charts';",
    "import { TerritoryEntityDirectory } from '../components/TerritoryEntityDirectory';\n": "",
    "import { pressForCommune, type PressCommuneResult } from '../lib/press';\n": "",
    "import { n, n1, titleCase } from '../lib/format';": "import { n, n1 } from '../lib/format';",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'No se encontró import esperado: {old}')
    text = text.replace(old, new, 1)

chile_import = "import { ChileMap } from '../components/ChileMap';\n"
workspace_import = "import { TerritoryCommuneWorkspace } from '../components/TerritoryCommuneWorkspace';\n"
if workspace_import not in text:
    if chile_import not in text:
        raise SystemExit('No se encontró import de ChileMap')
    text = text.replace(chile_import, chile_import + workspace_import, 1)

score_start = text.find('/** Un puntaje de amenaza alto')
islands_start = text.find('/** Islas oceánicas', score_start)
if score_start == -1 or islands_start == -1:
    raise SystemExit('No se encontró bloque scoreTone para retirar')
text = text[:score_start] + text[islands_start:]

commune_start = text.find('function ComunaDetalle({')
agg_start = text.find('/** Cifras del ámbito dibujado.', commune_start)
if commune_start == -1 or agg_start == -1:
    raise SystemExit('No se encontró bloque ComunaDetalle')

new_commune = """function ComunaDetalle({
  territoryId, onBack, onNavigate,
}: {
  territoryId: string;
  onBack: () => void;
  onNavigate: (hash: string) => void;
}) {
  const { data, error, loading, reload } = useRpc<TerritoryDetail | null>(
    'obs_territory_detail', { p_territory_id: territoryId },
  );

  if (loading) return <Loading label=\"Abriendo el detalle territorial…\" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title=\"Comuna no encontrada en el corte\" />;

  return (
    <TerritoryCommuneWorkspace
      data={data}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  );
}

"""
text = text[:commune_start] + new_commune + text[agg_start:]

press_start = text.find('/** Prensa que sitúa su mención en esta comuna.')
stat_start = text.find('function Stat(', press_start)
if press_start == -1 or stat_start == -1:
    raise SystemExit('No se encontró PrensaComunal para retirar')
text = text[:press_start] + text[stat_start:]

path.write_text(text, encoding='utf-8')
print('Territorio.tsx actualizado: detalle comunal delegado al nuevo workspace.')
