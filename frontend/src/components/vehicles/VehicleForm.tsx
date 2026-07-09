'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCar, FaTruck, FaChevronDown } from 'react-icons/fa';
import { getFuelType } from '@/lib/fuelMap';
import { VehicleType } from '@/types';

const CAR_MAKES: Record<string, string[]> = {
  'Abarth': ['124 Spider', '500', 'Punto'],
  'Acura': ['ILX', 'MDX', 'RDX', 'TLX', 'NSX', 'Integra', 'RLX'],
  'Aixam': ['City', 'Coupe', 'Scouty'],
  'Alfa Romeo': ['Giulia', 'Stelvio', 'Tonale', 'Spider', 'Giulietta', 'Mito', '159', 'Brera', 'GT'],
  'Alpine': ['A110', 'A310', 'A610'],
  'Aston Martin': ['DB11', 'DB12', 'DBS', 'Vantage', 'DBX', 'Valhalla', 'Valkyrie', 'Rapide', 'Vanquish'],
  'Audi': ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'e-tron', 'Q4 e-tron', 'Q6 e-tron', 'R8', 'TT', 'RS3', 'RS6', 'S3', 'S4'],
  'BAW': ['Tonik', 'Beijing 3', 'X5', 'X7'],
  'Bentley': ['Bentayga', 'Continental GT', 'Flying Spur', 'Mulsanne', 'Azure'],
  'BMW': ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series', '8 Series', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'XM', 'i3', 'i4', 'i5', 'i7', 'iX', 'iX1', 'iX3', 'Z4', 'M2', 'M3', 'M4', 'M5', 'M8'],
  'Brilliance': ['H230', 'H530', 'V3', 'V5'],
  'Bugatti': ['Chiron', 'Veyron', 'Divo'],
  'Buick': ['Enclave', 'Encore', 'Envision', 'LaCrosse', 'Regal', 'Verano', 'LeSabre', 'Park Avenue'],
  'BYD': ['Atto 3', 'Seal', 'Dolphin', 'Han', 'Tang', 'Yuan Plus', 'Seagull', 'Song', 'Qin'],
  'Cadillac': ['CT4', 'CT5', 'CT6', 'Escalade', 'XT4', 'XT5', 'XT6', 'Lyriq', 'Celestiq', 'DeVille', 'SRX', 'ATS'],
  'Caterham': ['Seven', 'Seven 170', 'Seven 420'],
  'Changhe': ['Freedom', 'Ideal'],
  'Chery': ['Tiggo 2', 'Tiggo 4', 'Tiggo 7', 'Tiggo 8', 'Arrizo 5', 'Arrizo 8', 'eQ1', 'OMODA 5'],
  'Chevrolet': ['Blazer', 'Camaro', 'Captiva', 'Colorado', 'Corvette', 'Cruze', 'Equinox', 'Impala', 'Malibu', 'Silverado', 'Spark', 'Suburban', 'Tahoe', 'TrailBlazer', 'Traverse', 'Trax', 'Aveo', 'Lacetti', 'Niva', 'Cobalt', 'Volt', 'Bolt EV'],
  'Chrysler': ['300', 'Pacifica', 'Voyager', 'Aspen', 'Crossfire', 'PT Cruiser', 'Sebring', 'Town & Country'],
  'Citroen': ['C1', 'C3', 'C4', 'C5', 'C5 Aircross', 'C6', 'Berlingo', 'Jumpy', 'Spacetourer', 'Ami', 'DS3', 'DS4', 'DS5', 'Xsara', 'Saxo'],
  'Cupra': ['Born', 'Formentor', 'Leon', 'Ateca', 'Tavascan'],
  'Dacia': ['Duster', 'Sandero', 'Logan', 'Spring', 'Lodgy', 'Dokker', 'Jogger'],
  'Daewoo': ['Lanos', 'Nexia', 'Matiz', 'Leganza', 'Espero', 'Nubira', 'Kalos', 'Magnus', 'Tico', 'Damas'],
  'Daihatsu': ['Charade', 'Cuore', 'Move', 'Sirion', 'Terios', 'Mira', 'Applause'],
  'Datsun': ['mi-DO', 'on-DO', 'GO', 'GO+'],
  'Dodge': ['Charger', 'Challenger', 'Durango', 'Grand Caravan', 'Journey', 'Viper', 'Caliber', 'Neon', 'Avenger', 'Magnum', 'Ram'],
  'DS': ['DS 3', 'DS 4', 'DS 5', 'DS 7', 'DS 9'],
  'FAW': ['Bestune', 'Besturn', 'X40', 'T77', 'V5'],
  'Ferrari': ['296 GTB', '296 GTS', '812 Superfast', 'F8 Tributo', 'SF90 Stradale', 'Purosangue', 'Roma', 'Portofino', '458', '488', 'LaFerrari', 'F40', 'Enzo', 'California'],
  'Fiat': ['500', '500X', '500L', 'Panda', 'Tipo', 'Punto', 'Doblo', 'Ducato', 'Fiorino', 'Scudo', 'Bravo', 'Stilo', 'Croma', 'Multipla', 'Uno', 'Palio', '124 Spider'],
  'Ford': ['Focus', 'Fiesta', 'Kuga', 'Explorer', 'Explorer EV', 'Mustang', 'Mustang Mach-E', 'Transit', 'Ranger', 'EcoSport', 'Edge', 'Escape', 'Expedition', 'F-150', 'F-250', 'Galaxy', 'Mondeo', 'Tourneo', 'Puma', 'Bronco', 'Capri', 'C-Max', 'S-Max', 'Fusion', 'Taurus'],
  'Forthing': ['T5', 'M7', 'S50'],
  'Foton': ['Tunland', 'Sauvana', 'Midi', 'View'],
  'Geely': ['Coolray', 'Monjaro', 'Tugella', 'Emgrand', 'Atlas', 'Geometry A', 'Geometry C', 'Xingyue', 'Binrui', 'Boyue', 'Preface', 'Icon'],
  'Genesis': ['G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80', 'GV90'],
  'GMC': ['Sierra', 'Yukon', 'Terrain', 'Acadia', 'Canyon', 'Hummer EV'],
  'Great Wall': ['Haval H6', 'Haval H2', 'Haval Jolion', 'Haval Dargo', 'Haval F7', 'Wingle 5', 'Wingle 7', 'Poer', 'Ora'],
  'Haval': ['H6', 'Jolion', 'Dargo', 'F7', 'H9', 'M6', 'H2', 'H4'],
  'Honda': ['Civic', 'Accord', 'CR-V', 'HR-V', 'Pilot', 'Fit', 'City', 'Jazz', 'Odyssey', 'Ridgeline', 'Passport', 'Insight', 'NSX', 'S2000', 'Element', 'Prelude', 'Integra'],
  'Hummer': ['H1', 'H2', 'H3', 'EV'],
  'Hyundai': ['Elantra', 'Santa Fe', 'Tucson', 'Palisade', 'Sonata', 'Ioniq 5', 'Ioniq 6', 'Ioniq 9', 'Kona', 'Creta', 'Solaris', 'Accent', 'Getz', 'Grandeur', 'Genesis', 'i10', 'i20', 'i30', 'i40', 'Santa Cruz', 'Staria', 'Veloster', 'Tucson N'],
  'Infiniti': ['Q50', 'QX50', 'QX60', 'Q60', 'QX80', 'FX35', 'FX37', 'M37', 'EX35'],
  'Iran Khodro': ['Samand', 'Runna', 'Dena', 'Soren', 'Peugeot Pars'],
  'Isuzu': ['D-Max', 'MU-X', 'Trooper', 'Rodeo', 'Axiom', 'VehiCross', 'KB Pikap', 'N-Series'],
  'JAC': ['J7', 'JS4', 'JS6', 'JS8', 'S3', 'S7', 'T6', 'T8'],
  'Jaguar': ['F-PACE', 'E-PACE', 'I-PACE', 'XE', 'XF', 'XJ', 'F-TYPE', 'X-Type', 'S-Type', 'XK'],
  'Jeep': ['Grand Cherokee', 'Wrangler', 'Compass', 'Cherokee', 'Renegade', 'Gladiator', 'Liberty', 'Patriot', 'Commander', 'Avenger'],
  'Jetour': ['X70', 'X90', 'X95', 'Dashing'],
  'Kia': ['Sportage', 'Sorento', 'Rio', 'K5', 'EV6', 'EV9', 'Telluride', 'Soul', 'Stinger', 'Ceed', 'Cerato', 'Forte', 'Niro', 'Picanto', 'Mohave', 'Carnival', 'Seltos', 'Optima', 'Sephia'],
  'Koenigsegg': ['Agera', 'Jesko', 'Regera', 'Gemera', 'CCX'],
  'Lada': ['Granta', 'Vesta', 'Niva', 'Largus', 'Priora', 'Kalina', 'X-Ray', '2107', '2106', '2114', '2115', 'Largus Cross', 'Vesta SW Cross', 'e-Largus'],
  'Lamborghini': ['Urus', 'Huracan', 'Aventador', 'Revuelto', 'Gallardo', 'Murcielago', 'Countach', 'Diablo', 'Miura'],
  'Lancia': ['Ypsilon', 'Delta', 'Thesis', 'Musa', 'Phedra'],
  'Land Rover': ['Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Range Rover Velar', 'Discovery', 'Discovery Sport', 'Defender', 'Freelander'],
  'Lexus': ['IS', 'ES', 'GS', 'LS', 'NX', 'RX', 'UX', 'LX', 'GX', 'RC', 'LC', 'RZ', 'LM'],
  'Lifan': ['Solano', 'X60', 'X70', 'Smily', 'Breez'],
  'Lincoln': ['Navigator', 'Aviator', 'Corsair', 'Nautilus', 'Continental', 'MKZ', 'MKC', 'MKX', 'Town Car'],
  'Lotus': ['Emira', 'Eletre', 'Evija', 'Exige', 'Elise', 'Evora', 'Esprit', 'Emeya'],
  'Lucid': ['Air', 'Gravity'],
  'Luxgen': ['URX', 'U6', 'M7'],
  'Maserati': ['Ghibli', 'Quattroporte', 'Levante', 'Grecale', 'MC20', 'GranTurismo', 'GranCabrio', '3200 GT'],
  'Mazda': ['Mazda2', 'Mazda3', 'Mazda6', 'CX-3', 'CX-30', 'CX-5', 'CX-50', 'CX-60', 'CX-90', 'MX-5', 'RX-8', 'RX-7', 'MX-30', 'BT-50', '323', '626', 'Premacy'],
  'McLaren': ['Artura', '750S', 'GT', 'Senna', 'Speedtail', 'P1', '720S', '600LT', '570S'],
  'Mercedes-Benz': ['A-Class', 'B-Class', 'C-Class', 'CLA', 'CLS', 'E-Class', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'EQV', 'G-Class', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'S-Class', 'SL', 'SLC', 'V-Class', 'AMG GT', 'Sprinter', 'Vito', 'Citan', 'ML', 'GLK', 'CLK', 'SLK', '190'],
  'Mercury': ['Grand Marquis', 'Mariner', 'Milan', 'Mountaineer', 'Sable'],
  'MG': ['MG3', 'MG4', 'MG5', 'MG6', 'MG ZS', 'MG HS', 'MG Marvel R', 'MG Cyberster', 'MG Hector', 'MG RX8', 'TF'],
  'Microcar': ['M.Go', 'M.8', 'Duke'],
  'Mini': ['Cooper', 'Cooper S', 'Countryman', 'Clubman', 'Convertible', 'Paceman', 'Coupe', 'Roadster', 'Aceman', 'John Cooper Works'],
  'Mitsubishi': ['Outlander', 'Pajero', 'L200', 'ASX', 'Eclipse Cross', 'Lancer', 'Mirage', 'Space Star', 'Montero', 'Galant', 'Colt', 'Delica', 'Carisma', 'Sigma'],
  'Morgan': ['Plus Four', 'Plus Six', 'Super 3'],
  'Moskvich': ['3', '6', '2140', '412', '408', 'Aleko'],
  'NIO': ['ES6', 'ES8', 'ET5', 'ET7', 'EC6', 'EL6', 'EL7', 'EL8'],
  'Nissan': ['Altima', 'Qashqai', 'X-Trail', 'Patrol', 'Leaf', 'Ariya', 'Navara', 'Sentra', 'Versa', 'Juke', 'Kicks', 'Murano', 'Pathfinder', 'Armada', 'Frontier', 'Micra', 'Almera', 'Teana', 'Skyline', 'GT-R', '350Z', '370Z', 'Note', 'Cube', 'Terrano', 'Maxima', 'Primera', 'Sunny'],
  'Oldsmobile': ['Alero', 'Aurora', 'Bravada', 'Cutlass', 'Silhouette'],
  'Opel': ['Astra', 'Corsa', 'Mokka', 'Crossland', 'Grandland', 'Insignia', 'Zafira', 'Vivaro', 'Combo', 'Karl', 'Adam', 'Cascada', 'Meriva', 'Antara', 'Speedster', 'GT', 'Calibra', 'Omega', 'Vectra', 'Signum', 'Frontera', 'Monterey', 'Senator', 'Rekord', 'Kadett', 'Ascona', 'Manta', 'Diplomat', 'Commodore', 'Kapitan', 'Olympia', 'Blitz'],
  'Pagani': ['Huayra', 'Zonda', 'Utopia'],
  'Peugeot': ['208', '308', '508', '2008', '3008', '5008', 'Rifter', 'Traveller', 'Partner', 'Expert', 'Boxer', 'e-208', 'e-308', 'e-2008', '408', 'RCZ', '607', '407', '307', '206', '106', '605', '405', '505', '504'],
  'Pininfarina': ['Battista'],
  'Plymouth': ['Barracuda', 'Road Runner', 'GTX', 'Fury', 'Valiant', 'Duster', 'Satellite', 'Belvedere', 'Savoy', 'Suburban'],
  'Polestar': ['1', '2', '3', '4'],
  'Pontiac': ['Firebird', 'GTO', 'Trans Am', 'Grand Prix', 'Bonneville', 'Solstice', 'Vibe', 'Montana', 'Aztek', 'Fiero', 'Sunfire', 'Grand Am'],
  'Porsche': ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan', 'Cayman', 'Boxster', '918 Spyder', 'Carrera GT', '718', 'Panamera Turbo'],
  'Proton': ['Persona', 'Saga', 'Waja', 'Wira', 'Perdana', 'Satria', 'Exora', 'X70', 'X50'],
  'RAM': ['1500', '2500', '3500', 'ProMaster', 'ProMaster City', 'Chassis Cab'],
  'Ravon': ['Gentra', 'R2', 'R4', 'Nexia', 'Matiz', 'Cobalt', 'Spark'],
  'Renault': ['Clio', 'Megane', 'Captur', 'Arkana', 'Duster', 'Koleos', 'Talisman', 'Zoe', 'Twingo', 'Scenic', 'Espace', 'Kadjar', 'Austral', 'Rafale', 'Master', 'Trafic', 'Kangoo', 'Laguna', 'Latitude', 'Fluence', 'Sandero', 'Logan', 'Symbol', 'Thalia', 'Modus', 'Avantime', 'Vel Satis', 'Safrane', '25', '21', '19', '5', '4'],
  'Rimac': ['Nevera', 'Concept One', 'Concept Two'],
  'Rivian': ['R1T', 'R1S', 'R2', 'R3'],
  'Rolls-Royce': ['Phantom', 'Ghost', 'Wraith', 'Dawn', 'Cullinan', 'Spectre', 'Silver Shadow', 'Silver Cloud', 'Corniche', 'Camargue'],
  'Rover': ['75', '45', '25', 'Streetwise', '200', '400', '600', '800', 'Mini', 'Metro', 'Maestro', 'Montego', 'SD1', 'P6', 'P5'],
  'Saab': ['9-3', '9-5', '900', '9000', '9-4X', '9-2X', 'Sonett', '96', '99', '900 Turbo'],
  'Saturn': ['S-Series', 'L-Series', 'Ion', 'Vue', 'Relay', 'Outlook', 'Aura', 'Sky'],
  'Scion': ['xA', 'xB', 'tC', 'xD', 'FR-S', 'iQ', 'iA', 'iM'],
  'Seat': ['Leon', 'Ibiza', 'Arona', 'Ateca', 'Tarraco', 'Alhambra', 'Mii', 'Toledo', 'Altea', 'Exeo', 'Malaga', 'Ronda', 'Fura'],
  'Skoda': ['Octavia', 'Superb', 'Kodiaq', 'Karoq', 'Kamiq', 'Fabia', 'Scala', 'Enyaq', 'Enyaq Coupe', 'Citigo', 'Rapid', 'Yeti', 'Roomster', 'Praktik', 'Felicia', 'Favorit', '105', '120', '130'],
  'Smart': ['Fortwo', 'Forfour', 'Roadster', 'Crossblade', 'EQ Fortwo', 'EQ Forfour', '#1'],
  'SsangYong': ['Korando', 'Tivoli', 'Rexton', 'Musso', 'Kyron', 'Actyon', 'Stavic', 'Chairman', 'Rodius'],
  'Subaru': ['Outback', 'Forester', 'Impreza', 'Legacy', 'WRX', 'BRZ', 'Crosstrek', 'XV', 'Solterra', 'Baja', 'SVX', 'XT', 'Justy', 'Leone', 'Alcyone', 'Tribeca', 'Ascent', 'Levorg'],
  'Suzuki': ['Swift', 'Vitara', 'S-Cross', 'Jimny', 'Baleno', 'Celerio', 'Ignis', 'Splash', 'Alto', 'Wagon R', 'Grand Vitara', 'Samurai', 'SJ', 'Cappuccino', 'Esteem', 'Kizashi', 'XL7', 'Across', 'Swace'],
  'TagAZ': ['Tager', 'Vortex Tingo', 'Aquila', 'Partner', 'C30', 'Road Partner'],
  'Tata': ['Safari', 'Harrier', 'Nexon', 'Altroz', 'Punch', 'Tiago', 'Tigor', 'Curvv', 'Indica', 'Indigo', 'Sumo', 'Xenon', 'Ace', 'Nano'],
  'Tesla': ['Model S', 'Model 3', 'Model X', 'Model Y', 'Cybertruck', 'Roadster', 'Semi'],
  'Toyota': ['Camry', 'Corolla', 'RAV4', 'Land Cruiser', 'Prado', 'Highlander', 'C-HR', 'Yaris', 'Yaris Cross', 'Hilux', 'Tacoma', 'Tundra', '4Runner', 'Sequoia', 'Sienna', 'Avalon', 'Mirai', 'Supra', 'GR86', 'GR Yaris', 'GR Corolla', 'bZ4X', 'Prius', 'Celica', 'MR2', 'Starlet', 'Tercel', 'Crown', 'Mark II', 'Chaser', 'Soarer', 'Ae86', 'FJ Cruiser', 'Fortuner', 'Innova', 'Vios', 'Wish', 'Rush', 'Avanza'],
  'Trabant': ['601', 'P50', 'P60', '1.1'],
  'Triumph': ['TR6', 'TR7', 'TR8', 'Spitfire', 'GT6', 'Herald', 'Vitesse', 'Dolomite', 'Toledo', 'Stag', '2000', '2500', 'Acclaim'],
  'UAZ': ['Patriot', 'Hunter', 'Bukhanka', '469', 'Pickup', 'Cargo', 'SGR', 'Simba', 'TIGER', 'Prof'],
  'Vauxhall': ['Astra', 'Corsa', 'Mokka', 'Crossland', 'Grandland', 'Insignia', 'Vivaro', 'Combo', 'Zafira', 'Adam', 'Meriva'],
  'VinFast': ['VF e34', 'VF 5', 'VF 6', 'VF 7', 'VF 8', 'VF 9', 'Lux A2.0', 'Lux SA2.0', 'Fadil', 'President'],
  'Volkswagen': ['Golf', 'Passat', 'Tiguan', 'T-Roc', 'T-Cross', 'Taigo', 'ID.3', 'ID.4', 'ID.5', 'ID.7', 'ID.Buzz', 'Polo', 'Lavida', 'Jetta', 'Beetle', 'Scirocco', 'Corrado', 'Phaeton', 'Touareg', 'Amarok', 'Caddy', 'Multivan', 'Caravelle', 'Transporter', 'Crafter', 'LT', 'Kaefer', 'Karmann Ghia', 'Type 3', 'Type 4', '181', 'Iltis'],
  'Volvo': ['XC40', 'XC60', 'XC90', 'S60', 'S90', 'V60', 'V90', 'C40', 'EX30', 'EX90', 'EM90', 'S40', 'V40', 'S80', 'V70', 'XC70', 'C30', 'C70', '850', '740', '240', 'Amazon', 'Duett', 'PV', 'P1800'],
  'Vortex': ['Tingo', 'Corda', 'Estina'],
  'Wartburg': ['353', '1.3', '311', '312'],
  'Wuling': ['Mini EV', 'Bingo', 'Air EV', 'Confero', 'Cortez', 'Almaz', 'Formo', 'Carry', 'Sunshine', 'Hongguang'],
  'Xiaomi': ['SU7'],
  'Zaporozhets': ['ZAZ 965', 'ZAZ 966', 'ZAZ 968', 'ZAZ 969', 'Tavria', 'Slavuta', 'Sens', 'Lanos', 'Vida', 'Chance', 'Forza'],
  'Zeekr': ['001', '007', '009', 'X', 'MIX', '7X'],
  'Zotye': ['T600', 'Z300', 'SR9', 'Coupa'],
};

interface VehicleFormProps {
  onSubmit: (data: {
    type: VehicleType;
    make: string;
    model: string;
    year: number;
    fuelType: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export function VehicleForm({ onSubmit, onCancel }: VehicleFormProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<VehicleType>('TRUCK');
  const [makeSearch, setMakeSearch] = useState('');
  const [selectedMake, setSelectedMake] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const years = useMemo(() => Array.from({ length: 32 }, (_, i) => currentYear - i), [currentYear]);
  const [year, setYear] = useState(currentYear);
  const [showMakeDropdown, setShowMakeDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const makeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const fuelType = getFuelType(selectedMake, selectedModel);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredMakes = Object.keys(CAR_MAKES)
    .filter((m) => m.toLowerCase().includes(makeSearch.toLowerCase()))
    .sort();

  const models = selectedMake ? CAR_MAKES[selectedMake] || [] : [];
  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (makeRef.current && !makeRef.current.contains(e.target as Node)) setShowMakeDropdown(false);
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setShowModelDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = async () => {
    if (!selectedMake || !selectedModel) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        type,
        make: selectedMake,
        model: selectedModel,
        year,
        fuelType,
      });
      setSelectedMake('');
      setSelectedModel('');
      setYear(new Date().getFullYear());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent-500/10 border border-accent-500/20 mb-1">
        <FaTruck size={14} className="text-accent-400" />
        <span className="text-xs text-accent-300 font-medium">{t('vehicleForm.truck')}</span>
      </div>

      <div className="relative" ref={makeRef}>
        <label className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.make')}</label>
        <input type="text" value={makeSearch || selectedMake}
          onChange={(e) => { setMakeSearch(e.target.value); setShowMakeDropdown(true); setSelectedMake(''); setSelectedModel(''); }}
          onFocus={() => setShowMakeDropdown(true)}
          className="input-field pr-8 text-sm" placeholder={t('vehicleForm.makePlaceholder')} />
        <FaChevronDown size={10} className="absolute right-3 bottom-3 text-gray-500 pointer-events-none" />
        {showMakeDropdown && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-dark-card border border-dark-border rounded-xl max-h-36 overflow-y-auto shadow-2xl">
            {filteredMakes.map((m) => (
              <button key={m} type="button" onClick={() => { setSelectedMake(m); setMakeSearch(m); setShowMakeDropdown(false); setModelSearch(''); }}
                className="w-full text-left px-3 py-2 text-xs text-white hover:bg-white/5 transition-all truncate">
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative" ref={modelRef}>
        <label className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.model')}</label>
        <input type="text" value={modelSearch || selectedModel}
          onChange={(e) => { setModelSearch(e.target.value); setShowModelDropdown(true); setSelectedModel(''); }}
          onFocus={() => setShowModelDropdown(true)}
          disabled={!selectedMake}
          className="input-field pr-8 text-sm disabled:opacity-50" placeholder={t('vehicleForm.modelPlaceholder')} />
        <FaChevronDown size={10} className="absolute right-3 bottom-3 text-gray-500 pointer-events-none" />
        {showModelDropdown && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-dark-card border border-dark-border rounded-xl max-h-36 overflow-y-auto shadow-2xl">
            {filteredModels.map((m) => (
              <button key={m} type="button" onClick={() => { setSelectedModel(m); setModelSearch(m); setShowModelDropdown(false); }}
                className="w-full text-left px-3 py-2 text-xs text-white hover:bg-white/5 transition-all truncate">
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.year')}</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="input-field text-sm">
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.fuel')}</label>
          <input type="text" value={fuelType} disabled
            className="input-field text-sm opacity-70" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={handleSubmit} disabled={!selectedMake || !selectedModel || isSubmitting}
          className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-50">
          {t('vehicleForm.save')}
        </button>
        <button onClick={onCancel}
          className="px-4 btn-secondary text-sm">
          {t('vehicleForm.cancel')}
        </button>
      </div>
    </div>
  );
}
