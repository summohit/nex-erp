import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * An OpenStreetMap map (Leaflet in a WebView), so the app needs no Google
 * Maps key. Draws a site pin with its geofence, where the person is now, the
 * road route to the site, and the path recorded so far. The page is loaded
 * once; new data is pushed into it, so the map does not flicker on refresh.
 */
export interface RouteMapData {
  site?: { lat: number; lng: number; name?: string; radiusM?: number } | null;
  me?: { lat: number; lng: number } | null;
  /** Planned road route, [[lat, lng], ...]. */
  path?: number[][];
  /** Recorded so far, [[lat, lng], ...]. */
  recorded?: number[][];
  /** Where the journey started. */
  start?: { lat: number; lng: number } | null;
}

const HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
html,body,#map{margin:0;height:100%;background:#F1F5F9}
.me{width:18px;height:18px;border-radius:50%;background:#1373E5;border:3px solid #fff;box-shadow:0 0 0 6px rgba(19,115,229,.22)}
.site{width:30px;height:30px;border-radius:10px 10px 10px 2px;transform:rotate(-45deg);background:#0F172A;border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35)}
.start{width:12px;height:12px;border-radius:50%;background:#10B981;border:2px solid #fff}
.leaflet-control-attribution{font-size:9px}
</style></head><body><div id="map"></div><script>
var map=L.map('map',{zoomControl:false,attributionControl:true}).setView([28.6139,77.2090],11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var layer=L.layerGroup().addTo(map), fitted=false;
window.update=function(d){
  layer.clearLayers(); var pts=[];
  if(d.path&&d.path.length>1){L.polyline(d.path,{color:'#1373E5',weight:5,opacity:.85,dashArray:d.routed===false?'8 8':null}).addTo(layer);pts=pts.concat(d.path);}
  if(d.recorded&&d.recorded.length>1){L.polyline(d.recorded,{color:'#10B981',weight:5,opacity:.9}).addTo(layer);pts=pts.concat(d.recorded);}
  if(d.site){
    if(d.site.radiusM)L.circle([d.site.lat,d.site.lng],{radius:d.site.radiusM,color:'#0F172A',weight:1,fillColor:'#1373E5',fillOpacity:.08}).addTo(layer);
    L.marker([d.site.lat,d.site.lng],{icon:L.divIcon({className:'',html:'<div class="site"></div>',iconSize:[30,30],iconAnchor:[8,30]})}).addTo(layer);
    pts.push([d.site.lat,d.site.lng]);
  }
  if(d.start){L.marker([d.start.lat,d.start.lng],{icon:L.divIcon({className:'',html:'<div class="start"></div>',iconSize:[12,12],iconAnchor:[6,6]})}).addTo(layer);pts.push([d.start.lat,d.start.lng]);}
  if(d.me){L.marker([d.me.lat,d.me.lng],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(layer);pts.push([d.me.lat,d.me.lng]);}
  if(pts.length&&!fitted){map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:16});fitted=true;}
};
window.refit=function(){fitted=false;};
true;
</script></body></html>`;

export default function RouteMap({ data, style }: { data: RouteMapData & { routed?: boolean }; style?: any }) {
  const ref = useRef<React.ComponentRef<typeof WebView>>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.update && window.update(${JSON.stringify(data)}); true;`);
  }, [ready, data]);

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: HTML, baseUrl: 'https://mira.ces-pl.com' }}
        onLoadEnd={() => setReady(true)}
        javaScriptEnabled
        scrollEnabled={false}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#F1F5F9' },
  web: { flex: 1, backgroundColor: 'transparent' },
});
