import { HEAVY_TRUCK_BRANDS } from './vehicleMakes';

export type FuelType = 'PETROL' | 'DIESEL' | 'ELECTRIC' | 'HYBRID' | 'LPG';

const EV_BRANDS = new Set([
  'tesla', 'nio', 'rivian', 'lucid', 'polestar', 'xpeng', 'zeekr', 'ora',
  'byd', 'vinfast',
]);

const EV_MODEL_PREFIXES = [
  'e-tron', 'ioniq', 'ev', 'id.', 'i3', 'i4', 'i5', 'i7', 'ix', 'ix1', 'ix3',
  'eqa', 'eqb', 'eqc', 'eqe', 'eqs', 'eqv',
  'leaf', 'ariya', 'zoe', 'ampera', 'spring',
  'mustang mach-e', 'explorer ev',
  'bz4x', 'mirai',
  'solterra',
  'c40', 'ec40', 'ex30', 'ex90', 'em90',
  '#1', '#3',
  'hummer ev',
  'e-largus',
  'cybertruck', 'semi',
  'good cat', 'funky cat',
  'atto 3', 'seal', 'dolphin', 'seagull',
  'kona electric',
  'mg4', 'mg marvel r',
  'enyaq',
  'taycan',
  'r1t', 'r1s', 'r2', 'r3',
  'air', 'gravity',
  'evija', 'eletre', 'emeya',
  'lyriq', 'celestiq',
  'rz',
  'gv60',
  'su7',
];

const DIESEL_MODEL_PREFIXES = [
  'transit', 'sprinter', 'crafter', 'master', 'ducato', 'boxer', 'jumpy',
  'ranger', 'amarok', 'hilux', 'navara', 'd-max', 'l200',
  'f-150', 'f-250', 'silverado', 'sierra', 'ram ',
  'touareg',
  'land cruiser', 'prado',
  'patriot', 'pickup',
];

export function getFuelType(make: string, model: string): FuelType {
  if (!make) return 'PETROL';
  const makeUpper = make.trim().toLowerCase();
  const modelUpper = model.trim().toLowerCase();

  if (EV_BRANDS.has(makeUpper)) {
    if (makeUpper === 'byd' && modelUpper.startsWith('song')) return 'HYBRID';
    if (makeUpper === 'vinfast' && (modelUpper.startsWith('lux') || modelUpper.startsWith('fadil'))) return 'PETROL';
    return 'ELECTRIC';
  }

  for (const prefix of EV_MODEL_PREFIXES) {
    if (modelUpper.startsWith(prefix) || modelUpper.includes(prefix)) {
      if (makeUpper === 'bmw' && prefix === 'i3' && !modelUpper.startsWith('i3')) continue;
      if (makeUpper === 'bmw' && prefix === 'i5' && !modelUpper.startsWith('i5')) continue;
      return 'ELECTRIC';
    }
  }

  for (const prefix of DIESEL_MODEL_PREFIXES) {
    if (modelUpper.startsWith(prefix)) return 'DIESEL';
  }

  if (makeUpper === 'smart' && (modelUpper === '#1' || modelUpper === '#3')) return 'ELECTRIC';
  if (makeUpper === 'ford' && modelUpper.startsWith('f-')) return 'DIESEL';

  if (makeUpper === 'uaz' || makeUpper === 'zaz' || makeUpper === 'lada') return 'PETROL';
  if (makeUpper === 'trabant' || makeUpper === 'wartburg') return 'PETROL';

  // Heavy-duty truck manufacturers (TRUCK_MAKES in VehicleForm) — virtually
  // every model these brands make is diesel, so this is more reliable than
  // trying to match every model name individually.
  if (HEAVY_TRUCK_BRANDS.has(makeUpper)) return 'DIESEL';

  return 'PETROL';
}
