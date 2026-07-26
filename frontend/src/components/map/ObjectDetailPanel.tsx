'use client';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FaBookmark, FaRegBookmark, FaChevronRight, FaClock, FaCompass, FaGlobe, FaMapMarkerAlt, FaPhone, FaStar, FaTimes } from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { mapApi, routesApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import Image from 'next/image';
import { useTranslation } from 'react-i18next';

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  GAS_STATION: 'gasStation', EV_CHARGER: 'evCharger',
  PARKING: 'parking', TRUCK_PARKING: 'truckParking',
  CAFE: 'cafe', RESTAURANT: 'restaurant',
  HOTEL: 'hotel', MOTEL: 'motel',
  TOILET: 'restroom', SHOWER: 'shower',
  PHARMACY: 'pharmacy', HOSPITAL: 'hospital', MEDICAL: 'medical',
  SHOP: 'shop', SUPERMARKET: 'supermarket', MALL: 'mall',
  SCHOOL: 'school', UNIVERSITY: 'university', KINDERGARTEN: 'kindergarten',
  BANK: 'bank', ATM: 'atm', BUS_STOP: 'busStop',
  METRO_STATION: 'metroStation', TRAIN_STATION: 'trainStation', AIRPORT: 'airport',
  PARK: 'park', SPORTS_FACILITY: 'sportsFacility', GOVERNMENT: 'government',
  ATTRACTION: 'attraction',
  TIRE_SERVICE: 'tireService', CAR_SERVICE: 'carService', CAR_WASH: 'carWash',
  REST_AREA: 'restArea', TOURIST_ATTRACTION: 'touristAttraction',
  BORDER_CROSSING: 'borderCrossing', WEIGH_STATION: 'weighStation', CUSTOMS: 'customs',
  SPEED_CAMERA: 'speedCamera', ROAD_WORKS: 'roadWorks', ACCIDENT: 'accident',
  TRAFFIC_LIGHT: 'trafficLight', POLICE: 'police',
};

export function ObjectDetailPanel() {
  const selectedObject = useMapStore(s => s.selectedObject);
  const setSelectedObject = useMapStore(s => s.setSelectedObject);
  const userLocation = useMapStore(s => s.userLocation);
  const toggleRoutesPanel = useMapStore(s => s.toggleRoutesPanel);
  const setDestination = useMapStore(s => s.setDestination);
  const setOrigin = useMapStore(s => s.setOrigin);
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  // isBookmarked used to persist across objects — since this panel stays
  // mounted while selectedObject swaps from one place to another (it's only
  // conditionally rendered on truthiness, not remounted per object), picking
  // a new marker right after bookmarking a previous one kept showing the
  // filled bookmark icon for a place that was never actually saved.
  useEffect(() => {
    setIsBookmarked(false);
  }, [selectedObject?.id]);

  if (!selectedObject) return null;

  const obj = selectedObject;

  const handleNavigate = async () => {
    if (!userLocation) { toast.error(t('objectDetailPanel.enableLocation')); return; }
    setIsNavigating(true);

    setOrigin({ ...userLocation, name: t('objectDetailPanel.myLocation') });
    setDestination({ lat: obj.lat, lng: obj.lng, name: obj.name });
    setSelectedObject(null);
    toggleRoutesPanel();
    setIsNavigating(false);
  };

  const handleBookmark = async () => {
    if (!user) { toast.error(t('objectDetailPanel.loginToBookmark')); return; }
    try {
      await mapApi.addBookmark({
        mapObjectId: obj.id,
        name: obj.name,
        lat: obj.lat,
        lng: obj.lng,
        address: obj.address,
      });
      setIsBookmarked(true);
      toast.success(t('objectDetailPanel.bookmarkSaved'));
    } catch {
      toast.error(t('objectDetailPanel.bookmarkFailed'));
    }
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <FaStar
        key={i}
        size={12}
        className={i < Math.round(rating) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}
      />
    ));
  };

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="absolute bottom-0 left-0 right-0 z-50 max-h-[75vh] overflow-hidden"
    >
      <div className="map-panel rounded-t-3xl flex flex-col overflow-hidden">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto">
          {/* Image header */}
          {obj.images && obj.images.length > 0 ? (
            <div className="relative h-44 mx-4 mt-2 rounded-2xl overflow-hidden">
              <Image src={obj.images[0]} alt={obj.name} fill className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-dark-bg/80 to-transparent" />
              {obj.isPremium && (
                <div className="absolute top-3 right-3 bg-accent-500 text-white text-[10px] font-bold
                                px-2 py-0.5 rounded-full">
                  {t('objectDetailPanel.featured')}
                </div>
              )}
            </div>
          ) : (
            <div className="h-20 mx-4 mt-2 rounded-2xl bg-gradient-to-br from-primary-900/40 to-dark-surface
                            flex items-center justify-center text-5xl">
              {getCategoryEmoji(obj.category)}
            </div>
          )}

          {/* Info */}
          <div className="px-4 py-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h2 className="font-display font-bold text-xl text-white truncate">{obj.name}</h2>
                <span className="text-xs text-primary-400 font-medium">
                  {t('objectDetailPanel.categories.' + (CATEGORY_LABEL_KEYS[obj.category] || obj.category))}
                </span>
              </div>
              <button
                onClick={handleBookmark}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  isBookmarked ? 'bg-accent-500/20 text-accent-400' : 'bg-white/10 text-gray-400'
                }`}
              >
                {isBookmarked ? <FaBookmark size={18} /> : <FaRegBookmark size={18} />}
              </button>
            </div>

            {/* Rating */}
            {obj.rating != null && obj.rating > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex">{renderStars(obj.rating)}</div>
                <span className="text-sm font-semibold text-white">{obj.rating.toFixed(1)}</span>
                <span className="text-xs text-gray-400">({obj.reviewCount} {t('objectDetailPanel.reviews')})</span>
              </div>
            )}

            {/* Distance */}
            {obj.distance !== undefined && (
              <div className="flex items-center gap-1.5 mt-2">
                <FaMapMarkerAlt size={12} className="text-primary-400" />
                <span className="text-xs text-gray-400">
                  {obj.distance < 1
                    ? `${Math.round(obj.distance * 1000)} ${t('objectDetailPanel.metersAway')}`
                    : `${obj.distance.toFixed(1)} ${t('objectDetailPanel.kmAway')}`}
                </span>
              </div>
            )}

            {/* Address */}
            {obj.address && (
              <p className="text-sm text-gray-400 mt-2 flex items-start gap-1.5">
                <FaMapMarkerAlt size={12} className="text-gray-500 flex-shrink-0 mt-0.5" />
                {obj.address}
              </p>
            )}

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              {obj.phone && (
                <a href={`tel:${obj.phone}`}
                   className="flex items-center gap-2 p-3 bg-white/5 rounded-xl text-sm text-white
                              border border-white/5 hover:bg-white/10 transition-all">
                  <FaPhone size={14} className="text-primary-400" />
                  <span className="truncate">{obj.phone}</span>
                </a>
              )}
              {obj.website && (
                <a href={obj.website} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-2 p-3 bg-white/5 rounded-xl text-sm text-white
                              border border-white/5 hover:bg-white/10 transition-all">
                  <FaGlobe size={14} className="text-primary-400" />
                  <span className="truncate">{t('objectDetailPanel.website')}</span>
                </a>
              )}
            </div>

            {/* Amenities */}
            {obj.amenities && obj.amenities.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-gray-400 mb-2">{t('objectDetailPanel.amenities')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {obj.amenities.map((a) => (
                    <span key={a} className="text-xs bg-white/5 text-gray-300 px-2 py-1 rounded-full
                                             border border-white/5">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Navigate button */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleNavigate}
              disabled={isNavigating}
              className="mt-5 w-full btn-primary py-4 flex items-center justify-center gap-2
                         text-base font-semibold disabled:opacity-50"
            >
              <FaCompass size={20} />
              {t('objectDetailPanel.navigateHere')}
            </motion.button>

            {/* Close */}
            <button
              onClick={() => setSelectedObject(null)}
              className="mt-2 w-full py-3 text-gray-400 hover:text-white text-sm transition-all
                         flex items-center justify-center gap-1"
            >
              <FaTimes size={14} />
              {t('objectDetailPanel.close')}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function getCategoryEmoji(category: string): string {
  const map: Record<string, string> = {
    GAS_STATION: '⛽', EV_CHARGER: '🔌', PARKING: '🅿️', TRUCK_PARKING: '🚛',
    CAFE: '☕', RESTAURANT: '🍽️', HOTEL: '🏨', MOTEL: '🛌',
    TOILET: '🚻', SHOWER: '🚿', PHARMACY: '💊', HOSPITAL: '🏥',
    SHOP: '🛒', SUPERMARKET: '🏪', MALL: '🏬',
    SCHOOL: '📚', UNIVERSITY: '🎓', KINDERGARTEN: '🧸',
    BANK: '🏦', ATM: '💳', BUS_STOP: '🚏',
    METRO_STATION: '🚇', TRAIN_STATION: '🚉', AIRPORT: '✈️',
    PARK: '🌲', SPORTS_FACILITY: '⚽', GOVERNMENT: '🏛️',
    ATTRACTION: '🏞️',
    TIRE_SERVICE: '🔧', CAR_SERVICE: '🔩', CAR_WASH: '🧽',
    REST_AREA: '🌳', TOURIST_ATTRACTION: '🏞️', BORDER_CROSSING: '🛂',
    WEIGH_STATION: '⚖️', CUSTOMS: '🛃', SPEED_CAMERA: '📷',
    ROAD_WORKS: '🚧', ACCIDENT: '🚨', TRAFFIC_LIGHT: '🚦', POLICE: '👮',
  };
  return map[category] || '📍';
}
