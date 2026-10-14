-- Solo actualiza reglas del PILOTO. No afecta ninguna tabla/contrato operativo de Atlas.
-- GAFI define APNFD por actividades específicas; casas de remate no lo son por su etiqueta.
update gafi_pilot.sector_map
set family='OTROS',
    certainty='NO_EQUIVALENCIA_AUTOMATICA',
    rationale='Casas de remate son SO en Chile, pero no equivalen por sí mismas a una categoría APNFD GAFI. Verificar si realizan otras actividades cubiertas.',
    rule_version='2026-10-14/v2',
    updated_at=now()
where uaf_sector='Casas de Remate y Martillo';
-- El alcance financiero para seguros en la definición GAFI es principalmente vida/inversión.
update gafi_pilot.sector_map
set certainty='ACTIVIDAD_CONDICIONAL',
    rationale='IF indicativa: para R.10-21 verificar seguros de vida/inversión y funciones concretas; el rubro de seguros no equivale íntegramente al alcance GAFI.',
    rule_version='2026-10-14/v2',
    updated_at=now()
where uaf_sector='Compañías de Seguros';
