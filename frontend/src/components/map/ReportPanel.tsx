'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { FaCamera, FaCheckCircle, FaExclamationTriangle, FaTimes, FaSpinner, FaImage, FaCommentDots } from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { reportsApi } from '@/lib/api';
import { ReportType } from '@/types';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface ReportCategory {
  type: ReportType;
  emoji: string;
  labelKey: string;
  color: string;
}

const REPORT_CATEGORIES: ReportCategory[][] = [
  [
    { type: 'ACCIDENT', emoji: '💥', labelKey: 'accident', color: 'text-red-400' },
    { type: 'TRAFFIC_JAM', emoji: '🚗', labelKey: 'trafficJam', color: 'text-orange-400' },
    { type: 'ROAD_WORKS', emoji: '🚧', labelKey: 'roadWorks', color: 'text-yellow-400' },
    { type: 'ROAD_CLOSURE', emoji: '🚫', labelKey: 'roadClosed', color: 'text-red-500' },
  ],
  [
    { type: 'SPEED_CAMERA', emoji: '📷', labelKey: 'speedCamera', color: 'text-blue-400' },
    { type: 'POLICE', emoji: '🚔', labelKey: 'police', color: 'text-blue-400' },
    { type: 'POTHOLE', emoji: '🕳️', labelKey: 'pothole', color: 'text-yellow-500' },
    { type: 'BAD_ROAD', emoji: '⚠️', labelKey: 'badRoad', color: 'text-orange-400' },
  ],
  [
    { type: 'ICE', emoji: '🧊', labelKey: 'ice', color: 'text-cyan-400' },
    { type: 'FOG', emoji: '🌫️', labelKey: 'fog', color: 'text-gray-400' },
    { type: 'FLOODING', emoji: '🌊', labelKey: 'flooding', color: 'text-blue-400' },
    { type: 'STRONG_WIND', emoji: '💨', labelKey: 'strongWind', color: 'text-sky-400' },
  ],
  [
    { type: 'LOW_BRIDGE', emoji: '🌉', labelKey: 'lowBridge', color: 'text-amber-400' },
    { type: 'WEIGHT_LIMIT', emoji: '🏋️', labelKey: 'weightLimit', color: 'text-purple-400' },
    { type: 'HEIGHT_LIMIT', emoji: '📏', labelKey: 'heightLimit', color: 'text-indigo-400' },
    { type: 'HAZARD', emoji: '⚠️', labelKey: 'other', color: 'text-red-400' },
  ],
];

export function ReportPanel() {
  const router = useRouter();
  const userLocation = useMapStore(s => s.userLocation);
  const { t } = useTranslation();
  const [selectedType, setSelectedType] = useState<ReportType | null>(null);
  const [severity, setSeverity] = useState(3);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reportLimit, setReportLimit] = useState<{ used: number; max: number } | null>(null);

  // Photo state
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoChecking, setPhotoChecking] = useState(false);
  const [photoValidated, setPhotoValidated] = useState<boolean[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    reportsApi.getLimit().then(res => {
      const data = res.data.data || res.data;
      setReportLimit(data);
    }).catch(() => {});
  }, []);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newFiles = [...photoFiles, ...files].slice(0, 3);
    setPhotoFiles(newFiles);

    // Convert to base64/data URLs for preview and validation
    const newPhotos: string[] = [];
    for (const file of newFiles) {
      const dataUrl = await fileToDataUrl(file);
      newPhotos.push(dataUrl);
    }
    setPhotos(newPhotos);
    setPhotoValidated(newPhotos.map(() => false));

    // Validate each new photo with AI
    setPhotoChecking(true);
    const validations: boolean[] = [];
    for (let i = 0; i < newPhotos.length; i++) {
      try {
        const res = await reportsApi.validatePhoto(newPhotos[i], selectedType || undefined, description || undefined);
        const result = res.data.data || res.data;
        if (result.valid) {
          validations.push(true);
        } else {
          validations.push(false);
          toast.error(t('reportPanel.photoRejected') + (result.reason ? ': ' + result.reason : ''));
        }
      } catch {
        validations.push(true);
      }
    }
    setPhotoValidated(validations);
    setPhotoChecking(false);

    const allValid = validations.every(v => v);
    if (allValid && validations.length > 0) {
      toast.success(t('reportPanel.photoAccepted'));
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoFiles(prev => prev.filter((_, i) => i !== index));
    setPhotoValidated(prev => prev.filter((_, i) => i !== index));
  };

  const [submittedData, setSubmittedData] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (submitted && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [submitted]);

  const handleSubmit = async () => {
    if (!selectedType || !userLocation) {
      toast.error(t('reportPanel.needLocation'));
      return;
    }

    if (reportLimit && reportLimit.used >= reportLimit.max) {
      toast.error(t('reportPanel.limitReached', { max: reportLimit.max }));
      return;
    }

    setIsSubmitting(true);
    try {
      const imageUrls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        if (photoValidated[i]) {
          imageUrls.push(photos[i]);
        }
      }

      const res = await reportsApi.create({
        type: selectedType,
        lat: userLocation.lat,
        lng: userLocation.lng,
        description: description.trim() || undefined,
        severity,
        images: imageUrls.length > 0 ? imageUrls : undefined,
      });

      setSubmittedData(res.data.data || res.data);
      setSubmitted(true);
      toast.success(t('reportPanel.submitted'));
      if (reportLimit) {
        setReportLimit({ ...reportLimit, used: reportLimit.used + 1 });
      }
      submitTimerRef.current = setTimeout(() => {
        useMapStore.setState({ isReportPanelOpen: false });
        setSubmitted(false);
        setSubmittedData(null);
        setSelectedType(null);
        setDescription('');
        setSeverity(3);
        setPhotos([]);
        setPhotoFiles([]);
        setPhotoValidated([]);
      }, 3000);
    } catch (err: any) {
      const msg = err?.response?.data?.message || t('reportPanel.submitFailed');
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasValidPhotos = photos.length === 0 || (photos.length > 0 && photoValidated.every(v => v) && !photoChecking);

  useEffect(() => {
    return () => {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    };
  }, []);

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="absolute bottom-0 left-0 right-0 z-50 max-h-[85vh] flex flex-col"
    >
      <div className="map-panel rounded-t-3xl sm:rounded-t-3xl overflow-hidden flex flex-col max-h-[85vh] h-full safe-bottom">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-dark-border">
          <div className="flex items-center gap-2">
            <FaExclamationTriangle size={18} className="text-accent-400" />
            <h2 className="font-display font-bold text-lg text-white">{t('reportPanel.reportHazard')}</h2>
          </div>
          <button
            onClick={() => useMapStore.setState({ isReportPanelOpen: false })}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all"
          >
            <FaTimes size={16} className="text-gray-400" />
          </button>
        </div>

        <div ref={scrollRef} className="overflow-y-auto flex-1 px-3 sm:px-4 pb-4 sm:pb-6 min-h-0">
          {submitted ? (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center justify-center py-12 gap-4"
            >
              <div className="w-16 h-16 bg-green-600/20 rounded-full flex items-center justify-center">
                <FaCheckCircle size={32} className="text-green-400" />
              </div>
              <p className="text-lg font-bold text-white">{t('reportPanel.thankYou')}</p>
              <p className="text-sm text-gray-400 text-center">
                {t('reportPanel.thankYouText')}
              </p>
              {submittedData?.id && (
                <div className="w-full bg-white/5 rounded-xl p-3 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>ID</span>
                    <span className="text-white font-mono">#{submittedData.id.slice(0, 8)}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>{t('reportPanel.status')}</span>
                    <span className="text-green-400 font-medium capitalize">{submittedData.status || t('reportPanel.underReview')}</span>
                  </div>
                  {submittedData.severity && (
                    <div className="flex justify-between text-gray-400">
                      <span>{t('reportPanel.severity')}</span>
                      <span className="text-white">{submittedData.severity}/5</span>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  const city = submittedData?.address?.split(',')[0]?.trim() || 'chat';
                  useMapStore.setState({ isReportPanelOpen: false });
                  router.push(`/chats`);
                }}
                className="mt-3 w-full py-3 rounded-xl bg-primary-600/20 text-primary-400 border border-primary-500/30 text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary-600/30 transition-all"
              >
                <FaCommentDots size={14} /> {t('reportPanel.discussInChat')}
              </button>
            </motion.div>
          ) : (
            <>
              {/* Report limit indicator */}
              {reportLimit && (
                <div className={`mt-3 flex items-center justify-between px-3 py-2 rounded-xl text-xs ${
                  reportLimit.used >= reportLimit.max
                    ? 'bg-red-600/20 border border-red-500/30 text-red-400'
                    : 'bg-white/5 border border-white/10 text-gray-400'
                }`}>
                  <span>{t('reportPanel.reportLimit', { used: reportLimit.used, max: reportLimit.max })}</span>
                  {reportLimit.used >= reportLimit.max && (
                    <span className="font-semibold">{t('reportPanel.limitReached', { max: reportLimit.max })}</span>
                  )}
                </div>
              )}

              {/* Report type grid */}
              <div className="mt-4 space-y-3">
                <p className="text-xs text-gray-400">{t('reportPanel.whatReporting')}</p>
                {REPORT_CATEGORIES.map((row, rowI) => (
                  <div key={rowI} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {row.map((cat) => (
                      <button
                        key={cat.type}
                        onClick={() => setSelectedType(cat.type)}
                        className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${
                          selectedType === cat.type
                            ? 'bg-primary-600/20 border-primary-500/60'
                            : 'bg-white/5 border-white/5 hover:bg-white/10'
                        }`}
                      >
                        <span className="text-2xl">{cat.emoji}</span>
                        <span className={`text-[9px] font-medium leading-tight text-center ${cat.color}`}>
                          {t('reportPanel.reportTypes.' + cat.labelKey)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              {/* Photo upload */}
              <div className="mt-4">
                <p className="text-xs text-gray-400 mb-2">{t('reportPanel.photo')}</p>
                <div className="flex gap-2 sm:gap-3 flex-wrap">
                  {photos.map((photo, i) => (
                    <div key={i} className="relative w-16 sm:w-20 h-16 sm:h-20 rounded-xl overflow-hidden border border-white/10">
                      <img src={photo} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                      {photoValidated[i] === false && (
                        <div className="absolute inset-0 bg-red-600/50 flex items-center justify-center">
                          <FaTimes size={16} className="text-white" />
                        </div>
                      )}
                      <button
                        onClick={() => removePhoto(i)}
                        className="absolute top-0.5 right-0.5 w-5 h-5 sm:w-6 sm:h-6 bg-black/60 rounded-full flex items-center justify-center touch-target z-10"
                      >
                        <FaTimes size={8} className="text-white" />
                      </button>
                    </div>
                  ))}
                  {photos.length < 3 && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={photoChecking}
                      className="w-16 sm:w-20 h-16 sm:h-20 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center hover:border-primary-500/50 hover:bg-white/5 transition-all"
                    >
                      {photoChecking ? (
                        <FaSpinner size={16} className="text-primary-400 animate-spin" />
                      ) : (
                        <FaCamera size={16} className="text-gray-500" />
                      )}
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handlePhotoSelect}
                  />
                </div>
                {photoChecking && (
                  <p className="text-xs text-primary-400 mt-1 flex items-center gap-1">
                    <FaSpinner size={10} className="animate-spin" />
                    {t('reportPanel.photoChecking')}
                  </p>
                )}
              </div>

              {/* Severity */}
              <div className="mt-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">{t('reportPanel.severity')}</p>
                  <span className="text-xs font-medium text-white">{severity}/5</span>
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSeverity(s)}
                      className="flex-1 flex items-center justify-center py-2 min-h-[44px]"
                    >
                      <div className={`w-full h-2 rounded-full transition-all ${
                        s <= severity
                          ? s <= 2 ? 'bg-green-500' : s <= 3 ? 'bg-yellow-500' : 'bg-red-500'
                          : 'bg-white/10'
                      }`} />
                    </button>
                  ))}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-gray-500">{t('reportPanel.minor')}</span>
                  <span className="text-[10px] text-gray-500">{t('reportPanel.critical')}</span>
                </div>
              </div>

              {/* Description */}
              <div className="mt-4">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('reportPanel.detailsPlaceholder')}
                  rows={3}
                  className="input-field resize-none text-sm"
                />
              </div>

              {/* Submit */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSubmit}
                disabled={!selectedType || isSubmitting || !hasValidPhotos || (reportLimit?.used ?? 0) >= (reportLimit?.max ?? 3)}
                className="mt-4 w-full btn-accent py-4 flex items-center justify-center gap-2
                           font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <FaExclamationTriangle size={18} />
                    {t('reportPanel.submit')}
                  </>
                )}
              </motion.button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
