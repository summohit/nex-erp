import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowLeft, Navigation, MapPin, Clock, Route as RouteIcon, RefreshCw } from 'lucide-react-native';
import RouteMap from '../../components/RouteMap';
import { fieldVisitRequestService as fv, RoutePreview } from '../../api/fieldVisitRequestService';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { colors, status, shadow } from '../../theme/ds';

/** How often the map re-reads your position while it is open. */
const REFRESH_MS = 30_000;

/**
 * Your way to today's site, inside the app: where you are, the road route
 * with distance and time, the site with its clock-in circle, and (during a
 * journey) the path recorded so far. Turn-by-turn directions hand over to
 * Google Maps. Reads your location only while this screen is open.
 */
export default function FieldVisitMapScreen() {
  const navigation = useNavigation<any>();
  const { requestId } = (useRoute<any>().params ?? {}) as { requestId: number };
  const [data, setData] = useState<RoutePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (!(await requestLocationPermission())) throw new Error('Allow location for MIRA to show your route.');
      const fix = await getCurrentLocation();
      setData(await fv.routePreview(requestId, fix.lat, fix.lng));
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not load the route.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const openDirections = () => {
    if (!data) return;
    const { lat, lng } = data.site;
    // Google Maps' own directions link: it opens the Maps app straight into
    // driving navigation. The google.navigation: scheme is also claimed by
    // apps like Uber, which made Android ask "Open with".
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving&dir_action=navigate`)
      .catch(() => undefined);
  };

  const inside = data ? data.straightKm * 1000 <= (data.site.radiusM || 0) : false;
  const eta = data ? new Date(Date.now() + data.minutes * 60000)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <View style={styles.page}>
      <RouteMap
        style={StyleSheet.absoluteFill}
        data={{
          site: data ? { ...data.site } : null,
          me: data?.from ?? null,
          path: data?.path,
          recorded: data?.recorded,
          routed: data?.routed,
        }}
      />

      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} activeOpacity={0.85}>
        <ArrowLeft size={20} color={colors.text} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.back, styles.refresh]} onPress={refresh} activeOpacity={0.85}>
        <RefreshCw size={18} color={colors.text} />
      </TouchableOpacity>

      <View style={styles.sheet}>
        <View style={styles.grabber} />
        {loading && !data ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Finding your route…</Text>
          </View>
        ) : error && !data ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={refresh}>
              <Text style={styles.secondaryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : data ? (
          <>
            <View style={styles.siteRow}>
              <View style={styles.siteIcon}><MapPin size={18} color={colors.primary} /></View>
              <View style={styles.flex}>
                <Text style={styles.overline}>{inside ? 'YOU ARE AT THE SITE' : 'HEADING TO'}</Text>
                <Text style={styles.siteName} numberOfLines={2}>{data.site.name}</Text>
              </View>
            </View>

            {inside ? (
              <View style={[styles.banner, { backgroundColor: status.success.bg, borderColor: status.success.border }]}>
                <Text style={[styles.bannerText, { color: status.success.strong }]}>
                  You are inside the clock-in area. Go back and tap Clock in at site.
                </Text>
              </View>
            ) : (
              <View style={styles.stats}>
                <View style={styles.stat}>
                  <RouteIcon size={14} color={colors.textMuted} />
                  <Text style={styles.statValue}>{data.roadKm} km</Text>
                  <Text style={styles.statLabel}>{data.routed ? 'by road' : 'approx.'}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.stat}>
                  <Clock size={14} color={colors.textMuted} />
                  <Text style={styles.statValue}>{data.minutes < 60 ? `${data.minutes} min` : `${Math.floor(data.minutes / 60)} h ${data.minutes % 60} m`}</Text>
                  <Text style={styles.statLabel}>arrive ~{eta}</Text>
                </View>
                {data.trackedKm != null && (
                  <>
                    <View style={styles.divider} />
                    <View style={styles.stat}>
                      <Navigation size={14} color={status.success.strong} />
                      <Text style={[styles.statValue, { color: status.success.strong }]}>{data.trackedKm} km</Text>
                      <Text style={styles.statLabel}>travelled</Text>
                    </View>
                  </>
                )}
              </View>
            )}

            <View style={styles.legend}>
              <View style={[styles.legendLine, { backgroundColor: colors.primary }]} />
              <Text style={styles.legendText}>Route to site</Text>
              {data.recorded.length > 1 && (
                <>
                  <View style={[styles.legendLine, { backgroundColor: status.success.fg, marginLeft: 12 }]} />
                  <Text style={styles.legendText}>Your path so far</Text>
                </>
              )}
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={openDirections} activeOpacity={0.85}>
              <Navigation size={17} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Start navigation</Text>
            </TouchableOpacity>
            {data.journeyActive && (
              <Text style={styles.footnote}>Journey in progress · your route is shared with finance until End journey.</Text>
            )}
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  back: {
    position: 'absolute', top: Platform.OS === 'ios' ? 54 : 18, left: 16, width: 42, height: 42, borderRadius: 14,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', ...shadow.raised,
  },
  refresh: { left: undefined, right: 16 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 28, ...shadow.hero,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  muted: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  errorText: { fontSize: 13, color: status.danger.strong, fontWeight: '700', textAlign: 'center' },
  siteRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  siteIcon: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, borderWidth: 1,
    borderColor: colors.primaryBorder, alignItems: 'center', justifyContent: 'center',
  },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: colors.textFaint },
  siteName: { fontSize: 16, fontWeight: '900', color: colors.text, marginTop: 1 },
  stats: {
    flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingVertical: 10, borderRadius: 16,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderSoft,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 17, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 10.5, fontWeight: '700', color: colors.textMuted },
  divider: { width: 1, height: 34, backgroundColor: colors.border },
  banner: { marginTop: 14, borderWidth: 1, borderRadius: 14, padding: 12 },
  bannerText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  legendLine: { width: 18, height: 4, borderRadius: 2 },
  legendText: { fontSize: 11.5, fontWeight: '600', color: colors.textMuted },
  primaryBtn: {
    marginTop: 14, height: 50, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.primarySoft },
  secondaryBtnText: { color: colors.primary, fontWeight: '800' },
  footnote: { marginTop: 10, fontSize: 11.5, color: colors.textMuted, textAlign: 'center' },
});
