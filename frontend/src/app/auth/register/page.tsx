'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { FaGoogle, FaEye, FaEyeSlash, FaUser, FaEnvelope, FaLock, FaAt, FaCar, FaTruck, FaChevronDown } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { authApi, usersApi } from '@/lib/api';
import LanguagePicker from '@/components/auth/LanguagePicker';
import { getFuelType } from '@/lib/fuelMap';
import { VehicleType } from '@/types';
import toast from 'react-hot-toast';

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
  'Opel': ['Astra', 'Corsa', 'Mokka', 'Grandland', 'Insignia', 'Meriva', 'Zafira', 'Vectra', 'Tigra', 'Omega', 'Kadett', 'Combo', 'Movano', 'Vivaro', 'Adam', 'Karl', 'Ampera', 'Frontera'],
  'Ora': ['Good Cat', 'Funky Cat', 'iQ', 'R1'],
  'Peugeot': ['208', '308', '3008', '4008', '5008', '508', '2008', 'Rifter', 'Partner', 'Traveller', 'Expert', 'Boxer', '107', '207', '307', '407', '607', '807', 'RCZ', '406', '405', '106', '205', '306'],
  'Polestar': ['2', '3', '4', '5'],
  'Pontiac': ['Aztek', 'Bonneville', 'Firebird', 'G6', 'Grand Am', 'Grand Prix', 'GTO', 'Solstice', 'Sunfire', 'Trans Am', 'Vibe'],
  'Porsche': ['Cayenne', 'Macan', 'Taycan', '911', 'Panamera', 'Cayman', 'Boxster', '918 Spyder', 'Carrera GT', '356'],
  'Proton': ['Persona', 'Saga', 'X50', 'X70', 'Exora', 'Iriz', 'Waja'],
  'RAM': ['1500', '2500', '3500', 'ProMaster', 'ProMaster City', 'Dakota'],
  'Ravon': ['R2', 'R3', 'R4', 'R5', 'Gentra', 'Matiz', 'Nexia'],
  'Renault': ['Clio', 'Duster', 'Arkana', 'Kaptur', 'Logan', 'Sandero', 'Master', 'Kangoo', 'Trafic', 'Zoe', 'Scenic', 'Megane', 'Laguna', 'Talisman', 'Espace', 'Vel Satis', 'Avantime', 'Twingo', 'Modus', 'Fluence', 'Latitude'],
  'Rivian': ['R1T', 'R1S', 'R2', 'R3'],
  'Rolls-Royce': ['Ghost', 'Phantom', 'Wraith', 'Dawn', 'Cullinan', 'Spectre', 'Silver Shadow', 'Silver Spur'],
  'Saab': ['9-3', '9-5', '900', '9000'],
  'Saturn': ['Aura', 'Ion', 'L-Series', 'Outlook', 'S-Series', 'Sky', 'Vue'],
  'SAIC': ['Maxus', 'RX5', 'i5', 'i6'],
  'SEAT': ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco', 'Alhambra', 'Altea', 'Toledo', 'Mii', 'Exeo'],
  'Skoda': ['Octavia', 'Kodiaq', 'Karoq', 'Superb', 'Fabia', 'Scala', 'Kamiq', 'Enyaq', 'Citigo', 'Roomster', 'Yeti', 'Rapid', 'Felicia', 'Favorit', 'Eltroq'],
  'Smart': ['Fortwo', 'Forfour', 'Roadster', '#1', '#3'],
  'SsangYong': ['Korando', 'Tivoli', 'Rexton', 'Musso', 'Kyron', 'Actyon', 'Rodius', 'Chairman'],
  'Subaru': ['Outback', 'Forester', 'Impreza', 'WRX', 'Legacy', 'Crosstrek', 'XV', 'Levorg', 'BRZ', 'Tribeca', 'Baja', 'SVX', 'Solterra', 'Ascent', 'Justy'],
  'Suzuki': ['Vitara', 'Swift', 'Jimny', 'S-Cross', 'Ignis', 'Baleno', 'Celerio', 'Alto', 'Wagon R', 'Ertiga', 'XL7', 'Kizashi', 'Grand Vitara', 'Samurai', 'SJ'],
  'TagAZ': ['Tager', 'Road Partner', 'Aquila', 'Vega'],
  'Tesla': ['Model 3', 'Model Y', 'Model S', 'Model X', 'Cybertruck', 'Roadster', 'Semi'],
  'Toyota': ['Camry', 'Corolla', 'RAV4', 'Land Cruiser', 'Hilux', 'Highlander', 'Tundra', 'Tacoma', '4Runner', 'Sequoia', 'Sienna', 'Prius', 'Yaris', 'Starlet', 'Tercel', 'Supra', 'GR86', 'GR Yaris', 'GR Corolla', 'Celica', 'MR2', 'Avalon', 'Avensis', 'Crown', 'Fortuner', 'Prado', 'Hiace', 'Probox', 'C-HR', 'bZ4X', 'Mirai'],
  'Trabant': ['601', 'P50'],
  'UAZ': ['Patriot', 'Pickup', 'Bukhanka', 'Hunter', '469', '3151', '452', 'Profi'],
  'Vauxhall': ['Astra', 'Corsa', 'Insignia', 'Mokka', 'Vivaro', 'Combo'],
  'VinFast': ['VF 5', 'VF 6', 'VF 7', 'VF 8', 'VF 9', 'Lux A2.0', 'Lux SA2.0'],
  'Volkswagen': ['Golf', 'Passat', 'Tiguan', 'Touareg', 'ID.3', 'ID.4', 'ID.5', 'ID.7', 'ID.Buzz', 'Polo', 'Virtus', 'Teramont', 'Amarok', 'Caddy', 'Crafter', 'Transporter', 'Multivan', 'California', 'Beetle', 'Jetta', 'Scirocco', 'Corrado', 'Phaeton', 'Sharan', 'Touran', 'Up', 'Lupo', 'Fox', 'Golf R', 'GTI', 'Arteon', 'CC', 'T-Cross', 'T-Roc', 'Taigo', 'Nivus', 'Lavida', 'Santana', 'Bora', 'Magotan'],
  'Volvo': ['XC40', 'XC60', 'XC90', 'S40', 'S60', 'S80', 'S90', 'V40', 'V60', 'V90', 'C30', 'C40', 'C70', 'EX30', 'EX90', 'EM90', 'EC40', '850', '240', '740', '940', 'Amazon', 'P1800'],
  'Vortex': ['Corda', 'Tingo', 'Estina'],
  'Voyah': ['Free', 'Dream', 'Passion', 'Courage'],
  'Wartburg': ['353', '1.3'],
  'Xiaomi': ['SU7'],
  'XPeng': ['G3', 'G6', 'G9', 'P5', 'P7', 'X9'],
  'Zaporozhets': ['ZAZ 965', 'ZAZ 966', 'ZAZ 968'],
  'ZAZ': ['Lanos', 'Vida', 'Sens', 'Chance', 'Tavria', 'Slavuta', 'Forza'],
  'Zeekr': ['001', '007', '009', 'X', 'MIX', '7X'],
  'Zotye': ['T600', 'Z300', 'SR9', 'Coupa'],
};

const ALL_MAKES = Object.keys(CAR_MAKES).sort((a, b) => a.localeCompare(b));

export default function RegisterPage() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { setUser, setTokens } = useAuthStore();
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const years = useMemo(() => Array.from({ length: currentYear - 1969 + 1 }, (_, i) => currentYear - i), [currentYear]);
  const [form, setForm] = useState({
    email: '', username: '', displayName: '', password: '', lang: 'ru',
    vehicleType: 'CAR' as VehicleType,
    vehicleMake: '', vehicleModel: '', vehicleYear: currentYear,
  });
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [makeSearch, setMakeSearch] = useState('');
  const [showMakeDropdown, setShowMakeDropdown] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [vehicleFuel, setVehicleFuel] = useState('PETROL');
  const makeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const TRUCK_MAKES = ['Ford', 'Isuzu', 'RAM', 'Toyota', 'Volkswagen'];
  const TYPE_MAKES: Record<string, string[]> = { CAR: ALL_MAKES, TRUCK: TRUCK_MAKES };

  const filteredMakes = useMemo(() => {
    const available = TYPE_MAKES[form.vehicleType] || ALL_MAKES;
    return available.filter(m => m.toLowerCase().includes(makeSearch.toLowerCase()));
  }, [form.vehicleType, makeSearch]);

  const availableModels = useMemo(() => {
    return CAR_MAKES[form.vehicleMake] || [];
  }, [form.vehicleMake]);

  const filteredModels = useMemo(() => {
    return availableModels.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase()));
  }, [availableModels, modelSearch]);

  // Auto-detect fuel type when make/model changes
  useEffect(() => {
    const fuel = getFuelType(form.vehicleMake, form.vehicleModel);
    setVehicleFuel(fuel);
  }, [form.vehicleMake, form.vehicleModel]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (makeRef.current && !makeRef.current.contains(e.target as Node)) setShowMakeDropdown(false);
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setShowModelDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) { toast.error(t('auth.register.passwordTooShort')); return; }
    setIsLoading(true);
    try {
      const payload = {
        email: form.email,
        username: form.username,
        displayName: form.displayName,
        password: form.password,
        lang: form.lang,
      };
      const res = await authApi.register(payload);
      const { user, accessToken, refreshToken } = res.data.data || res.data || {};
      const data = res.data.data || res.data;

      if (data?.needsVerification) {
        toast.success(t('auth.verify.codeSent'));
        router.push(`/auth/verify?email=${encodeURIComponent(form.email)}`);
        return;
      }

      setTokens(accessToken, refreshToken);
      setUser(user);

      // If vehicle info was filled, save it after registration
      if (form.vehicleMake && form.vehicleModel) {
        usersApi.addVehicle({
          type: form.vehicleType,
          make: form.vehicleMake,
          model: form.vehicleModel,
          year: form.vehicleYear,
          fuelType: vehicleFuel,
          name: `${form.vehicleMake} ${form.vehicleModel}`,
        }).catch(() => {});
      }

      toast.success(t('auth.register.welcome'));
      router.push('/');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('auth.register.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setIsGoogleLoading(true);
    try {
      localStorage.setItem('pending_lang', form.lang);
      localStorage.setItem('preferred_lang', form.lang);
      await signIn('google', { callbackUrl: '/' }, { state: JSON.stringify({ lang: form.lang }) });
    } catch {
      toast.error(t('auth.register.googleFailed'));
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-dark-bg flex flex-col overflow-y-auto safe-bottom safe-top">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[50vw] h-[50vw] max-w-80 max-h-80 bg-primary-900/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-[40vw] h-[40vw] max-w-64 max-h-64 bg-accent-900/10 rounded-full blur-3xl" />
      </div>

      <div className="relative flex-1 flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex items-center gap-3 mb-8">
          <Image src="/logo.png" alt={t('auth.register.brand')} width={48} height={48} className="rounded-xl object-cover" />
          <div>
            <h1 className="font-display text-2xl font-black text-white">ROVX</h1>
            <p className="text-primary-400 text-xs">{t('auth.register.brand')}</p>
          </div>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="w-full max-w-sm">
          <div className="card p-6">
            <h2 className="font-display font-bold text-xl text-white mb-1">{t('auth.register.title')}</h2>
            <p className="text-sm text-gray-400 mb-5">{t('auth.register.subtitle')}</p>

            {/* Google OAuth */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleGoogleSignUp}
              disabled={isGoogleLoading}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl
                         bg-white hover:bg-gray-100 text-gray-800 font-semibold text-sm
                         transition-all disabled:opacity-60 mb-4 shadow-sm"
            >
              {isGoogleLoading ? (
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
              ) : (
                <FaGoogle size={18} className="text-red-500" />
              )}
              {t('auth.register.continueWithGoogle')}
            </motion.button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-dark-border" />
              <span className="text-xs text-gray-500">{t('auth.register.orEmail')}</span>
              <div className="flex-1 h-px bg-dark-border" />
            </div>

            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.displayNameLabel')}</label>
                <div className="relative">
                  <FaUser size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type="text" value={form.displayName} onChange={update('displayName')} className="input-field pl-9" placeholder={t('auth.register.displayNamePlaceholder')} required />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.usernameLabel')}</label>
                <div className="relative">
                  <FaAt size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type="text" value={form.username} onChange={update('username')} className="input-field pl-9" placeholder={t('auth.register.usernamePlaceholder')} pattern="[a-zA-Z0-9_]+" minLength={3} maxLength={30} required />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.emailLabel')}</label>
                <div className="relative">
                  <FaEnvelope size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type="email" value={form.email} onChange={update('email')} className="input-field pl-9" placeholder={t('auth.register.emailPlaceholder')} required />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.passwordLabel')}</label>
                <div className="relative">
                  <FaLock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type={showPass ? 'text' : 'password'} value={form.password} onChange={update('password')} className="input-field pl-9 pr-10" placeholder={t('auth.register.passwordPlaceholder')} minLength={8} required />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showPass ? <FaEyeSlash size={13} /> : <FaEye size={13} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.language')}</label>
                <LanguagePicker value={form.lang} onChange={(code) => { setForm((p) => ({ ...p, lang: code })); i18n.changeLanguage(code); }} />
              </div>

              {/* Vehicle section */}
              <div className="pt-2 border-t border-dark-border">
                <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">{t('auth.register.vehicleSection')}</p>

                {/* Vehicle type toggle */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button type="button" onClick={() => { setForm(p => ({ ...p, vehicleType: 'CAR', vehicleMake: '', vehicleModel: '' })); setMakeSearch(''); setModelSearch(''); }}
                    className={`flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium transition-all border ${
                      form.vehicleType === 'CAR'
                        ? 'bg-primary-600/30 border-primary-500/50 text-white'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}>
                    <FaCar size={14} /> {t('auth.register.car')}
                  </button>
                  <button type="button" onClick={() => { setForm(p => ({ ...p, vehicleType: 'TRUCK', vehicleMake: '', vehicleModel: '' })); setMakeSearch(''); setModelSearch(''); }}
                    className={`flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium transition-all border ${
                      form.vehicleType === 'TRUCK'
                        ? 'bg-primary-600/30 border-primary-500/50 text-white'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}>
                    <FaTruck size={14} /> {t('auth.register.truck')}
                  </button>
                </div>

                {/* Make (autocomplete) */}
                <div className="relative mb-3" ref={makeRef}>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.makeLabel')}</label>
                  <input type="text" value={makeSearch || form.vehicleMake}
                    onChange={(e) => { setMakeSearch(e.target.value); setShowMakeDropdown(true); setForm(p => ({ ...p, vehicleMake: '', vehicleModel: '' })); }}
                    onFocus={() => { setMakeSearch(''); setShowMakeDropdown(true); }}
                    className="input-field pr-10" placeholder={t('auth.register.makePlaceholder')} />
                  <FaChevronDown size={12} className="absolute right-3 bottom-3 text-gray-500 pointer-events-none" />
                  {showMakeDropdown && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-dark-card border border-dark-border rounded-xl max-h-40 overflow-y-auto shadow-2xl">
                      {filteredMakes.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-3">{t('auth.register.noMatches')}</p>
                      ) : filteredMakes.map(m => (
                        <button key={m} type="button" onClick={() => {
                          setForm(p => ({ ...p, vehicleMake: m }));
                          setMakeSearch(m);
                          setShowMakeDropdown(false);
                        }}
                          className={`w-full text-left px-3 py-2 text-sm transition-all hover:bg-white/5 ${
                            form.vehicleMake === m ? 'text-primary-400 bg-primary-600/10' : 'text-gray-300'
                          }`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Model (autocomplete, filtered by make) */}
                <div className="relative mb-3" ref={modelRef}>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.modelLabel')}</label>
                  <input type="text" value={modelSearch || form.vehicleModel}
                    onChange={(e) => { setModelSearch(e.target.value); setShowModelDropdown(true); setForm(p => ({ ...p, vehicleModel: '' })); }}
                    onFocus={() => { setShowModelDropdown(true); }}
                    disabled={!form.vehicleMake}
                    className="input-field pr-10 disabled:opacity-40" placeholder={form.vehicleMake ? t('auth.register.modelPlaceholderSelect') : t('auth.register.modelPlaceholderFirst')} />
                  <FaChevronDown size={12} className="absolute right-3 bottom-3 text-gray-500 pointer-events-none" />
                  {showModelDropdown && form.vehicleMake && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-dark-card border border-dark-border rounded-xl max-h-40 overflow-y-auto shadow-2xl">
                      {filteredModels.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-3">{t('auth.register.noMatches')}</p>
                      ) : filteredModels.map(m => (
                        <button key={m} type="button" onClick={() => {
                          setForm(p => ({ ...p, vehicleModel: m }));
                          setModelSearch(m);
                          setShowModelDropdown(false);
                        }}
                          className={`w-full text-left px-3 py-2 text-sm transition-all hover:bg-white/5 ${
                            form.vehicleModel === m ? 'text-primary-400 bg-primary-600/10' : 'text-gray-300'
                          }`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Year */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.yearLabel')}</label>
                  <select value={form.vehicleYear} onChange={update('vehicleYear')}
                    className="input-field appearance-none">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>

                {/* Fuel type (auto-detected) */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-xs text-gray-400">{t('auth.register.fuelLabel')}</span>
                  <span className={`text-xs font-semibold ${
                    vehicleFuel === 'ELECTRIC' ? 'text-green-400' :
                    vehicleFuel === 'DIESEL' ? 'text-orange-400' :
                    vehicleFuel === 'HYBRID' ? 'text-cyan-400' :
                    'text-yellow-400'
                  }`}>
                    {vehicleFuel === 'ELECTRIC' ? `⚡ ${t('auth.register.electric')}` :
                     vehicleFuel === 'DIESEL' ? `⛽ ${t('auth.register.diesel')}` :
                     vehicleFuel === 'HYBRID' ? `🔋 ${t('auth.register.hybrid')}` :
                     vehicleFuel === 'LPG' ? `🟢 ${t('auth.register.lpg')}` :
                     `⛽ ${t('auth.register.petrol')}`}
                  </span>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={isLoading}
                className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 font-semibold text-base disabled:opacity-50 mt-2"
              >
                {isLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('auth.register.submit')}
              </motion.button>
            </form>

            <p className="text-center text-sm text-gray-400 mt-6">
              {t('auth.register.hasAccount')}{' '}
              <Link href="/auth/login" className="text-primary-400 hover:text-primary-300 font-medium">{t('auth.register.signIn')}</Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
