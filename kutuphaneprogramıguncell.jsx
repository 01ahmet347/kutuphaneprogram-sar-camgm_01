// EK DÜZELTME: Firebase ve öğrenci oturumları sekmeye özeldir; yetkisiz yönetici görünümü girişe döner.
// EK DÜZELTME: Ayar kaydı ihbarı kapatmaz; yönetici listesi oturum kapsamında dinlenir.
// Sunucu ayarları tüm açık ekranlara anında uygulanır; mola ihbarı engellenir.
// EK DÜZELTME: Güncel anonim kayıt tokenı, ayrı öğrenci oturumu ve sunucuda atomik yönetici hesabı oluşturma.
// EK DÜZELTME: Yönetici kaydı güncel Firebase tokenıyla doğrulanır; eski oturum sonuçları yok sayılır.
// EK DÜZELTME: Hesap onayı/kısıt değişikliği sunucu transaction'ı tamamlanmadan başarılı sayılmaz.
// Yeni kayıtlar onay beklemeye devam eder; yönetici açıkça onayladığında öğrenci güncellenir.
// EK DÜZELTME: Eski cihaz kayıt engeli kaldırıldı; sunucu kimlik doğrulaması korunur.
// Tekli/toplu kısıt kaldırmada ihbar yetkisi açılır; eski aktif hesaplar YP'de onarılır.
// 2026-10-08 EK SENKRONİZASYON DÜZELTMELERİ:
// - Silinen öğrenci hesabının cihaz oturumu ve ilgili kayıt önbelleği temizlenir.
// - Yönetici listesinde eski yerel kullanıcılar sunucu silmesini geri alamaz.
// - Öğrenci krokisi güncel sunucu masa durumunu kullanır.
// - Masa bırakma güncel masa kimliğiyle yapılır; sunucu sonucu doğrulanır.
// - Kayıt servisi /api/student-register ve sunucu masa işlemleri ayrı dosyalardır.
//   Kayıt kurtarma, güncellenmiş api/student-register.js ile birlikte çalışır.
// EK DÜZELTMELER: giriş/oturum logları, QR mola dönüşü, ihbar hedefi,
// ortak hesap kısıtı + YP ihbar yetkisi görünümü, önceki kapanış kurtarma.
// Bu dosya mevcut React dosyanızın yerine kullanılır; diğer importlar korunmuştur.
// GEREKLİ SUNUCU KONTROLÜ: /api/student-activity audit-event izin listesi
// OGRENCI_, ÖĞRENCİ_, İHBAR/IHBAR olaylarını kabul etmelidir.
// Tüm tarayıcılar kapalıyken 22:00 temizliği için sunucu zamanlayıcısı gerekir.
// Sunucu/API dosyaları ekte olmadığından bu dosyada değiştirilememiştir.
// ============================================================
// 2026-10 KOTA / SENKRONIZASYON TOPARLAMA
// - Firestore parçalı belge yapısı korunur.
// - Öğrenci cihazı log/ihlal/geri bildirim arşivlerini realtime dinlemez.
// - Eski loglar uygulama açılışında yeniden arşivlenmez.
// - Loglar tek kalıcı sgmAudit arşivine yazılır; yalnızca admin arşivi dinler.
// - Öğrenci kişisel mesajı tek sgmMessages belgesinden ve FCM'den alır.
// - Masa seçimi/QR/ihlal ve silme sunucu transaction'larıyla doğrulanır.
// - Gönderilemeyen log/ihlal/geri bildirim ve bildirim istekleri cihazda bekletilir.
// - Eski sabit kroki ve günlük giriş kodu ayar kalıntıları kaldırıldı.
// - Yönetici şifresi frontend paketinden çıkarıldı; /api/admin-login kullanılır.
// Not: guest* alanları mevcut eski Firestore kayıtlarını bozmamak için şema uyumluluğu amacıyla tutulur;
// öğrenci arayüzünde yeni misafir akışı kullanılmamalıdır.
// ============================================================

import React, { useState, useEffect, useMemo, useRef, Component } from 'react';
import { 
  BookOpen, Clock, AlertTriangle, CheckCircle, User, 
  QrCode, LogOut, Info, ShieldAlert, Coffee, MapPin, 
  StopCircle, LogIn, X, Settings, Users, List, 
  Shield, Smartphone, ArrowRight, Eye, RefreshCw, FileText, Camera,
  Move, Plus, Save, PenTool, Trash2, Edit3
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, runTransaction, collection, getDoc, getDocs, getDocFromServer, query, orderBy, limit, startAfter, deleteDoc } from 'firebase/firestore';

import { getMessaging, getToken, onMessage, isSupported as isMessagingSupported } from 'firebase/messaging';
import { mergePendingRows, nonConflictingPatch, atomicFieldPatch, changedFields, mapLimited, sessionCanRestore } from './src/sync-core.js';
import { createCloudActions } from './src/cloud-transactions.js';
import { APP_VERSION, BUILD_COMMIT } from './src/version.js';

let app, auth, db, appId;
let tabAuthPersistenceReady = Promise.resolve(null);
try {
  const configuredFirebase = typeof __firebase_config !== 'undefined'
    ? __firebase_config
    : import.meta.env.VITE_FIREBASE_CONFIG;

  if (configuredFirebase) {
    const firebaseConfig = typeof configuredFirebase === 'string'
      ? JSON.parse(configuredFirebase)
      : configuredFirebase;
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    // Firebase kimliği sekmeye özeldir. Öğrenci sekmesi yönetici tokenını değiştirmez.
    tabAuthPersistenceReady = setPersistence(auth, browserSessionPersistence).then(
      () => null,
      error => { console.error('Sekme oturumu başlatılamadı:', error?.code || 'unknown'); return error; }
    );
    db = getFirestore(app);
    appId = typeof __app_id !== 'undefined'
      ? __app_id
      : import.meta.env.VITE_FIREBASE_APP_ID || 'default-app-id';
  }
} catch (error) {
  console.error("Firebase init error:", error);
}

const ensureTabAuthPersistence = async () => {
  const error = await tabAuthPersistenceReady;
  if (error) throw new Error('Bu sekmede oturum saklanamadı. Tarayıcı oturum depolamasını kontrol edip yeniden giriş yapın.');
};
const signInTabWithCustomToken = async token => {
  await ensureTabAuthPersistence();
  return signInWithCustomToken(auth, token);
};
const signInTabAnonymously = async () => {
  await ensureTabAuthPersistence();
  return signInAnonymously(auth);
};

const deletedUserIds = new Set((() => {
  try { return JSON.parse(localStorage.getItem('sgm_deleted_user_ids') || '[]'); }
  catch { return []; }
})());


const formatTime = (ms) => {
  if (ms < 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const formatDateTime = (date) => {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const generateId = () => Math.random().toString(36).substr(2, 9);

const getLocalDayKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};




// Mevcut saat ayarlarıyla aynı cihaz saatini kullanır (kurum: Türkiye).
const updatedBreakAllowance = (user, before, after) => {
  const next = {...(user.breaks || {})};
  for (const type of ['short', 'long']) {
    const key = type === 'short' ? 'shortBreakCount' : 'longBreakCount';
    const oldLimit = Math.max(0, Number(before[key]) || 0);
    const newLimit = Math.max(0, Number(after[key]) || 0);
    const remaining = Number.isFinite(Number(user.breaks?.[type])) ? Number(user.breaks[type]) : oldLimit;
    next[type] = Math.max(0, Math.min(newLimit, remaining + newLimit - oldLimit));
  }
  return next;
};

const getLastClosingAt = (closeTime, at = Date.now()) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(closeTime || ''));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return 0;
  const closing = new Date(at);
  closing.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (closing.getTime() > at) closing.setDate(closing.getDate() - 1);
  return closing.getTime();
};
const hasSessionBeforeClosing = (desk, cutoff) => {
  if (!desk || !cutoff) return false;
  const timestamps = [];
  if (desk.occupant) timestamps.push(Number(desk.sessionStartTime || 0));
  if (desk.guestOccupant) timestamps.push(Number(desk.guestSessionStartTime || 0));
  if (desk.pendingOccupant) timestamps.push(Number(desk.pendingDeskDeadline || 0) - 5 * 60 * 1000);
  // Tarihi eksik eski kayıtlar açılışta temizlenir; yeni geçerli oturum varsa korunur.
  return timestamps.length > 0 && timestamps.every(t => !Number.isFinite(t) || t <= 0 || t <= cutoff);
};
const clearClosedDesk = desk => ({
  ...desk, status: desk.status === 'disabled' ? 'disabled' : 'available',
  occupant: null, ownerDeviceId: null, guestOccupant: null, guestSessionStartTime: null,
  guestBreakEndTime: null, guestReported: false, guestReportEndTime: null,
  guestReportIssuedAt: null, guestReportVerifiedAt: null,
  pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null,
  breakEndTime: null, reportEndTime: null, reportIssuedAt: null,
  reportVerifiedAt: null, sessionStartTime: null
});

const getMonthKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const getDaysInMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();




const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const getDeviceId = () => {
  let did = localStorage.getItem('sgm_device_id');
  if (!did) {
    did = 'DEV-' + generateId();
    localStorage.setItem('sgm_device_id', did);
  }
  return did;
};

// Global Sanitization Functions for Consistency
const cleanIdentityFormat = (str) => String(str || '').replace(/\D/g, '');

const cleanPinFormat = (str) => {
  if (!str) return "";
  return String(str)
      .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .toLowerCase();
};

// Ad-soyad karşılaştırmalarında boşluk ve büyük/küçük harf farklarını yok sayar.
// Böylece aynı öğrenci adı farklı yazım biçimleriyle tekrar kaydedilemez.
const cleanNameFormat = (str) => {
  if (!str) return "";
  return String(str)
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('tr-TR');
};

const DEFAULT_SETTINGS = {
  openTime: '07:00',
  closeTime: '22:00',
  longBreakCount: 2,
  longBreakDuration: 60,
  shortBreakCount: 5,
  shortBreakDuration: 15,
  breakCooldown: 30,
  reportWaitTime: 5,
  strikeLimit: 2,
  reportsEnabled: true,
  useCustomLayout: true,
  layoutSchemaVersion: 3,
  // Kroki alanlarının tüm cihazlarda anlık görünürlüğünü yönetir.
  showMainLibraryKroki: true,
  showBlueRoomKroki: false,
  institutionName: 'Sarıçam Gençlik Merkezi',
  institutionShortName: 'Sarıçam GM',
  managerName: '',
  registrationFormUrl: '',
  registrationFormHistory: [],
  registrationFormUpdatedAt: 0,
};

const INITIAL_DESKS = Array.from({ length: 35 }, (_, i) => ({
  id: i + 1,
  status: 'available',
  occupant: null,
  // Masayı alan ana kullanıcının cihazı.
  ownerDeviceId: null,
  // LEGACY: Eski verilerle uyumluluk için misafir alanları okunur; yeni öğrenci akışında kullanılmaz.
  guestOccupant: null,
  guestSessionStartTime: null,
  guestBreakEndTime: null,
  guestReported: false,
  guestReportEndTime: null,
  guestReportIssuedAt: null,
  guestReportVerifiedAt: null,
  // QR doğrulaması tamamlanana kadar masa/konuk kontenjanını 5 dakika rezerve eder.
  pendingOccupant: null,
  pendingDeskRole: null,
  pendingDeskDeadline: null,
  breakEndTime: null,
  reportEndTime: null,
  reportIssuedAt: null,
  reportVerifiedAt: null,
  sessionStartTime: null,
  qrCode: 'QR-' + (i + 1) + '-' + generateId(),
}));

const legacyIdentity = (id) => { let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))>>>0; return String(10000000+h%90000000); };

// QR görselleri internet / üçüncü taraf görsel servisi olmadan bu dosyada üretilir.
// qrcode-generator 2.0.4, Copyright (c) 2009 Kazuhiko Arase, MIT License.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
const SGM_QR_FACTORY=(()=>{const v=function(w,x){let s=w;const l=j[x];let e=null,t=0,u=null;const p=[],y={},h=function(r,c){t=s*4+17,e=(function(n){const f=new Array(n);for(let i=0;i<n;i+=1){f[i]=new Array(n);for(let g=0;g<n;g+=1)f[i][g]=null}return f})(t),a(0,0),a(t-7,0),a(0,t-7),D(),P(),m(r,c),s>=7&&E(r),u==null&&(u=nt(s,l,p)),R(u,c)},a=function(r,c){for(let n=-1;n<=7;n+=1)if(!(r+n<=-1||t<=r+n))for(let f=-1;f<=7;f+=1)c+f<=-1||t<=c+f||(0<=n&&n<=6&&(f==0||f==6)||0<=f&&f<=6&&(n==0||n==6)||2<=n&&n<=4&&2<=f&&f<=4?e[r+n][c+f]=!0:e[r+n][c+f]=!1)},_=function(){let r=0,c=0;for(let n=0;n<8;n+=1){h(!0,n);const f=O.getLostPoint(y);(n==0||r>f)&&(r=f,c=n)}return c},P=function(){for(let r=8;r<t-8;r+=1)e[r][6]==null&&(e[r][6]=r%2==0);for(let r=8;r<t-8;r+=1)e[6][r]==null&&(e[6][r]=r%2==0)},D=function(){const r=O.getPatternPosition(s);for(let c=0;c<r.length;c+=1)for(let n=0;n<r.length;n+=1){const f=r[c],i=r[n];if(e[f][i]==null)for(let g=-2;g<=2;g+=1)for(let A=-2;A<=2;A+=1)g==-2||g==2||A==-2||A==2||g==0&&A==0?e[f+g][i+A]=!0:e[f+g][i+A]=!1}},E=function(r){const c=O.getBCHTypeNumber(s);for(let n=0;n<18;n+=1){const f=!r&&(c>>n&1)==1;e[Math.floor(n/3)][n%3+t-8-3]=f}for(let n=0;n<18;n+=1){const f=!r&&(c>>n&1)==1;e[n%3+t-8-3][Math.floor(n/3)]=f}},m=function(r,c){const n=l<<3|c,f=O.getBCHTypeInfo(n);for(let i=0;i<15;i+=1){const g=!r&&(f>>i&1)==1;i<6?e[i][8]=g:i<8?e[i+1][8]=g:e[t-15+i][8]=g}for(let i=0;i<15;i+=1){const g=!r&&(f>>i&1)==1;i<8?e[8][t-i-1]=g:i<9?e[8][15-i-1+1]=g:e[8][15-i-1]=g}e[t-8][8]=!r},R=function(r,c){let n=-1,f=t-1,i=7,g=0;const A=O.getMaskFunction(c);for(let B=t-1;B>0;B-=2)for(B==6&&(B-=1);;){for(let M=0;M<2;M+=1)if(e[f][B-M]==null){let T=!1;g<r.length&&(T=(r[g]>>>i&1)==1),A(f,B-M)&&(T=!T),e[f][B-M]=T,i-=1,i==-1&&(g+=1,i=7)}if(f+=n,f<0||t<=f){f-=n,n=-n;break}}},et=function(r,c){let n=0,f=0,i=0;const g=new Array(c.length),A=new Array(c.length);for(let b=0;b<c.length;b+=1){const C=c[b].dataCount,L=c[b].totalCount-C;f=Math.max(f,C),i=Math.max(i,L),g[b]=new Array(C);for(let I=0;I<g[b].length;I+=1)g[b][I]=255&r.getBuffer()[I+n];n+=C;const Q=O.getErrorCorrectPolynomial(L),G=K(g[b],Q.getLength()-1).mod(Q);A[b]=new Array(Q.getLength()-1);for(let I=0;I<A[b].length;I+=1){const J=I+G.getLength()-A[b].length;A[b][I]=J>=0?G.getAt(J):0}}let B=0;for(let b=0;b<c.length;b+=1)B+=c[b].totalCount;const M=new Array(B);let T=0;for(let b=0;b<f;b+=1)for(let C=0;C<c.length;C+=1)b<g[C].length&&(M[T]=g[C][b],T+=1);for(let b=0;b<i;b+=1)for(let C=0;C<c.length;C+=1)b<A[C].length&&(M[T]=A[C][b],T+=1);return M},nt=function(r,c,n){const f=F.getRSBlocks(r,c),i=S();for(let A=0;A<n.length;A+=1){const B=n[A];i.put(B.getMode(),4),i.put(B.getLength(),O.getLengthInBits(B.getMode(),r)),B.write(i)}let g=0;for(let A=0;A<f.length;A+=1)g+=f[A].dataCount;if(i.getLengthInBits()>g*8)throw"code length overflow. ("+i.getLengthInBits()+">"+g*8+")";for(i.getLengthInBits()+4<=g*8&&i.put(0,4);i.getLengthInBits()%8!=0;)i.putBit(!1);for(;!(i.getLengthInBits()>=g*8||(i.put(236,8),i.getLengthInBits()>=g*8));)i.put(17,8);return et(i,f)};y.addData=function(r,c){c=c||"Byte";let n=null;switch(c){case"Numeric":n=X(r);break;case"Alphanumeric":n=Z(r);break;case"Byte":n=$(r);break;case"Kanji":n=W(r);break;default:throw"mode:"+c}p.push(n),u=null},y.isDark=function(r,c){if(r<0||t<=r||c<0||t<=c)throw r+","+c;return e[r][c]},y.getModuleCount=function(){return t},y.make=function(){if(s<1){let r=1;for(;r<40;r++){const c=F.getRSBlocks(r,l),n=S();for(let i=0;i<p.length;i++){const g=p[i];n.put(g.getMode(),4),n.put(g.getLength(),O.getLengthInBits(g.getMode(),r)),g.write(n)}let f=0;for(let i=0;i<c.length;i++)f+=c[i].dataCount;if(n.getLengthInBits()<=f*8)break}s=r}h(!1,_())},y.createTableTag=function(r,c){r=r||2,c=typeof c>"u"?r*4:c;let n="";n+='<table style="',n+=" border-width: 0px; border-style: none;",n+=" border-collapse: collapse;",n+=" padding: 0px; margin: "+c+"px;",n+='">',n+="<tbody>";for(let f=0;f<y.getModuleCount();f+=1){n+="<tr>";for(let i=0;i<y.getModuleCount();i+=1)n+='<td style="',n+=" border-width: 0px; border-style: none;",n+=" border-collapse: collapse;",n+=" padding: 0px; margin: 0px;",n+=" width: "+r+"px;",n+=" height: "+r+"px;",n+=" background-color: ",n+=y.isDark(f,i)?"#000000":"#ffffff",n+=";",n+='"/>';n+="</tr>"}return n+="</tbody>",n+="</table>",n},y.createSvgTag=function(r,c,n,f){let i={};typeof arguments[0]=="object"&&(i=arguments[0],r=i.cellSize,c=i.margin,n=i.alt,f=i.title),r=r||2,c=typeof c>"u"?r*4:c,n=typeof n=="string"?{text:n}:n||{},n.text=n.text||null,n.id=n.text?n.id||"qrcode-description":null,f=typeof f=="string"?{text:f}:f||{},f.text=f.text||null,f.id=f.text?f.id||"qrcode-title":null;const g=y.getModuleCount()*r+c*2;let A,B,M,T,b="",C;for(C="l"+r+",0 0,"+r+" -"+r+",0 0,-"+r+"z ",b+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',b+=i.scalable?"":' width="'+g+'px" height="'+g+'px"',b+=' viewBox="0 0 '+g+" "+g+'" ',b+=' preserveAspectRatio="xMinYMin meet"',b+=f.text||n.text?' role="img" aria-labelledby="'+U([f.id,n.id].join(" ").trim())+'"':"",b+=">",b+=f.text?'<title id="'+U(f.id)+'">'+U(f.text)+"</title>":"",b+=n.text?'<description id="'+U(n.id)+'">'+U(n.text)+"</description>":"",b+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',b+='<path d="',M=0;M<y.getModuleCount();M+=1)for(T=M*r+c,A=0;A<y.getModuleCount();A+=1)y.isDark(M,A)&&(B=A*r+c,b+="M"+B+","+T+C);return b+='" stroke="transparent" fill="black"/>',b+="</svg>",b},y.createDataURL=function(r,c){r=r||2,c=typeof c>"u"?r*4:c;const n=y.getModuleCount()*r+c*2,f=c,i=n-c;return tt(n,n,function(g,A){if(f<=g&&g<i&&f<=A&&A<i){const B=Math.floor((g-f)/r),M=Math.floor((A-f)/r);return y.isDark(M,B)?0:1}else return 1})},y.createImgTag=function(r,c,n){r=r||2,c=typeof c>"u"?r*4:c;const f=y.getModuleCount()*r+c*2;let i="";return i+="<img",i+=' src="',i+=y.createDataURL(r,c),i+='"',i+=' width="',i+=f,i+='"',i+=' height="',i+=f,i+='"',n&&(i+=' alt="',i+=U(n),i+='"'),i+="/>",i};const U=function(r){let c="";for(let n=0;n<r.length;n+=1){const f=r.charAt(n);switch(f){case"<":c+="&lt;";break;case">":c+="&gt;";break;case"&":c+="&amp;";break;case'"':c+="&quot;";break;default:c+=f;break}}return c},rt=function(r){r=typeof r>"u"?2:r;const n=y.getModuleCount()*1+r*2,f=r,i=n-r;let g,A,B,M,T;const b={"\u2588\u2588":"\u2588","\u2588 ":"\u2580"," \u2588":"\u2584","  ":" "},C={"\u2588\u2588":"\u2580","\u2588 ":"\u2580"," \u2588":" ","  ":" "};let L="";for(g=0;g<n;g+=2){for(B=Math.floor((g-f)/1),M=Math.floor((g+1-f)/1),A=0;A<n;A+=1)T="\u2588",f<=A&&A<i&&f<=g&&g<i&&y.isDark(B,Math.floor((A-f)/1))&&(T=" "),f<=A&&A<i&&f<=g+1&&g+1<i&&y.isDark(M,Math.floor((A-f)/1))?T+=" ":T+="\u2588",L+=r<1&&g+1>=i?C[T]:b[T];L+=`
`}return n%2&&r>0?L.substring(0,L.length-n-1)+Array(n+1).join("\u2580"):L.substring(0,L.length-1)};return y.createASCII=function(r,c){if(r=r||1,r<2)return rt(c);r-=1,c=typeof c>"u"?r*2:c;const n=y.getModuleCount()*r+c*2,f=c,i=n-c;let g,A,B,M;const T=Array(r+1).join("\u2588\u2588"),b=Array(r+1).join("  ");let C="",L="";for(g=0;g<n;g+=1){for(B=Math.floor((g-f)/r),L="",A=0;A<n;A+=1)M=1,f<=A&&A<i&&f<=g&&g<i&&y.isDark(B,Math.floor((A-f)/r))&&(M=0),L+=M?T:b;for(B=0;B<r;B+=1)C+=L+`
`}return C.substring(0,C.length-1)},y.renderTo2dContext=function(r,c){c=c||2;const n=y.getModuleCount();for(let f=0;f<n;f++)for(let i=0;i<n;i++)r.fillStyle=y.isDark(f,i)?"black":"white",r.fillRect(i*c,f*c,c,c)},y};v.stringToBytes=function(w){const x=[];for(let d=0;d<w.length;d+=1){const o=w.charCodeAt(d);x.push(o&255)}return x},v.createStringToBytes=function(w,x){const d=(function(){const s=q(w),l=function(){const u=s.read();if(u==-1)throw"eof";return u};let e=0;const t={};for(;;){const u=s.read();if(u==-1)break;const p=l(),y=l(),h=l(),a=String.fromCharCode(u<<8|p),_=y<<8|h;t[a]=_,e+=1}if(e!=x)throw e+" != "+x;return t})(),o=63;return function(s){const l=[];for(let e=0;e<s.length;e+=1){const t=s.charCodeAt(e);if(t<128)l.push(t);else{const u=d[s.charAt(e)];typeof u=="number"?(u&255)==u?l.push(u):(l.push(u>>>8),l.push(u&255)):l.push(o)}}return l}};const k={MODE_NUMBER:1,MODE_ALPHA_NUM:2,MODE_8BIT_BYTE:4,MODE_KANJI:8},j={L:1,M:0,Q:3,H:2},N={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7},O=(function(){const w=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],x=1335,d=7973,o=21522,s={},l=function(e){let t=0;for(;e!=0;)t+=1,e>>>=1;return t};return s.getBCHTypeInfo=function(e){let t=e<<10;for(;l(t)-l(x)>=0;)t^=x<<l(t)-l(x);return(e<<10|t)^o},s.getBCHTypeNumber=function(e){let t=e<<12;for(;l(t)-l(d)>=0;)t^=d<<l(t)-l(d);return e<<12|t},s.getPatternPosition=function(e){return w[e-1]},s.getMaskFunction=function(e){switch(e){case N.PATTERN000:return function(t,u){return(t+u)%2==0};case N.PATTERN001:return function(t,u){return t%2==0};case N.PATTERN010:return function(t,u){return u%3==0};case N.PATTERN011:return function(t,u){return(t+u)%3==0};case N.PATTERN100:return function(t,u){return(Math.floor(t/2)+Math.floor(u/3))%2==0};case N.PATTERN101:return function(t,u){return t*u%2+t*u%3==0};case N.PATTERN110:return function(t,u){return(t*u%2+t*u%3)%2==0};case N.PATTERN111:return function(t,u){return(t*u%3+(t+u)%2)%2==0};default:throw"bad maskPattern:"+e}},s.getErrorCorrectPolynomial=function(e){let t=K([1],0);for(let u=0;u<e;u+=1)t=t.multiply(K([1,H.gexp(u)],0));return t},s.getLengthInBits=function(e,t){if(1<=t&&t<10)switch(e){case k.MODE_NUMBER:return 10;case k.MODE_ALPHA_NUM:return 9;case k.MODE_8BIT_BYTE:return 8;case k.MODE_KANJI:return 8;default:throw"mode:"+e}else if(t<27)switch(e){case k.MODE_NUMBER:return 12;case k.MODE_ALPHA_NUM:return 11;case k.MODE_8BIT_BYTE:return 16;case k.MODE_KANJI:return 10;default:throw"mode:"+e}else if(t<41)switch(e){case k.MODE_NUMBER:return 14;case k.MODE_ALPHA_NUM:return 13;case k.MODE_8BIT_BYTE:return 16;case k.MODE_KANJI:return 12;default:throw"mode:"+e}else throw"type:"+t},s.getLostPoint=function(e){const t=e.getModuleCount();let u=0;for(let h=0;h<t;h+=1)for(let a=0;a<t;a+=1){let _=0;const P=e.isDark(h,a);for(let D=-1;D<=1;D+=1)if(!(h+D<0||t<=h+D))for(let E=-1;E<=1;E+=1)a+E<0||t<=a+E||D==0&&E==0||P==e.isDark(h+D,a+E)&&(_+=1);_>5&&(u+=3+_-5)}for(let h=0;h<t-1;h+=1)for(let a=0;a<t-1;a+=1){let _=0;e.isDark(h,a)&&(_+=1),e.isDark(h+1,a)&&(_+=1),e.isDark(h,a+1)&&(_+=1),e.isDark(h+1,a+1)&&(_+=1),(_==0||_==4)&&(u+=3)}for(let h=0;h<t;h+=1)for(let a=0;a<t-6;a+=1)e.isDark(h,a)&&!e.isDark(h,a+1)&&e.isDark(h,a+2)&&e.isDark(h,a+3)&&e.isDark(h,a+4)&&!e.isDark(h,a+5)&&e.isDark(h,a+6)&&(u+=40);for(let h=0;h<t;h+=1)for(let a=0;a<t-6;a+=1)e.isDark(a,h)&&!e.isDark(a+1,h)&&e.isDark(a+2,h)&&e.isDark(a+3,h)&&e.isDark(a+4,h)&&!e.isDark(a+5,h)&&e.isDark(a+6,h)&&(u+=40);let p=0;for(let h=0;h<t;h+=1)for(let a=0;a<t;a+=1)e.isDark(a,h)&&(p+=1);const y=Math.abs(100*p/t/t-50)/5;return u+=y*10,u},s})(),H=(function(){const w=new Array(256),x=new Array(256);for(let o=0;o<8;o+=1)w[o]=1<<o;for(let o=8;o<256;o+=1)w[o]=w[o-4]^w[o-5]^w[o-6]^w[o-8];for(let o=0;o<255;o+=1)x[w[o]]=o;const d={};return d.glog=function(o){if(o<1)throw"glog("+o+")";return x[o]},d.gexp=function(o){for(;o<0;)o+=255;for(;o>=256;)o-=255;return w[o]},d})(),K=function(w,x){if(typeof w.length>"u")throw w.length+"/"+x;const d=(function(){let s=0;for(;s<w.length&&w[s]==0;)s+=1;const l=new Array(w.length-s+x);for(let e=0;e<w.length-s;e+=1)l[e]=w[e+s];return l})(),o={};return o.getAt=function(s){return d[s]},o.getLength=function(){return d.length},o.multiply=function(s){const l=new Array(o.getLength()+s.getLength()-1);for(let e=0;e<o.getLength();e+=1)for(let t=0;t<s.getLength();t+=1)l[e+t]^=H.gexp(H.glog(o.getAt(e))+H.glog(s.getAt(t)));return K(l,0)},o.mod=function(s){if(o.getLength()-s.getLength()<0)return o;const l=H.glog(o.getAt(0))-H.glog(s.getAt(0)),e=new Array(o.getLength());for(let t=0;t<o.getLength();t+=1)e[t]=o.getAt(t);for(let t=0;t<s.getLength();t+=1)e[t]^=H.gexp(H.glog(s.getAt(t))+l);return K(e,0).mod(s)},o},F=(function(){const w=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],x=function(s,l){const e={};return e.totalCount=s,e.dataCount=l,e},d={},o=function(s,l){switch(l){case j.L:return w[(s-1)*4+0];case j.M:return w[(s-1)*4+1];case j.Q:return w[(s-1)*4+2];case j.H:return w[(s-1)*4+3];default:return}};return d.getRSBlocks=function(s,l){const e=o(s,l);if(typeof e>"u")throw"bad rs block @ typeNumber:"+s+"/errorCorrectionLevel:"+l;const t=e.length/3,u=[];for(let p=0;p<t;p+=1){const y=e[p*3+0],h=e[p*3+1],a=e[p*3+2];for(let _=0;_<y;_+=1)u.push(x(h,a))}return u},d})(),S=function(){const w=[];let x=0;const d={};return d.getBuffer=function(){return w},d.getAt=function(o){const s=Math.floor(o/8);return(w[s]>>>7-o%8&1)==1},d.put=function(o,s){for(let l=0;l<s;l+=1)d.putBit((o>>>s-l-1&1)==1)},d.getLengthInBits=function(){return x},d.putBit=function(o){const s=Math.floor(x/8);w.length<=s&&w.push(0),o&&(w[s]|=128>>>x%8),x+=1},d},X=function(w){const x=k.MODE_NUMBER,d=w,o={};o.getMode=function(){return x},o.getLength=function(e){return d.length},o.write=function(e){const t=d;let u=0;for(;u+2<t.length;)e.put(s(t.substring(u,u+3)),10),u+=3;u<t.length&&(t.length-u==1?e.put(s(t.substring(u,u+1)),4):t.length-u==2&&e.put(s(t.substring(u,u+2)),7))};const s=function(e){let t=0;for(let u=0;u<e.length;u+=1)t=t*10+l(e.charAt(u));return t},l=function(e){if("0"<=e&&e<="9")return e.charCodeAt(0)-48;throw"illegal char :"+e};return o},Z=function(w){const x=k.MODE_ALPHA_NUM,d=w,o={};o.getMode=function(){return x},o.getLength=function(l){return d.length},o.write=function(l){const e=d;let t=0;for(;t+1<e.length;)l.put(s(e.charAt(t))*45+s(e.charAt(t+1)),11),t+=2;t<e.length&&l.put(s(e.charAt(t)),6)};const s=function(l){if("0"<=l&&l<="9")return l.charCodeAt(0)-48;if("A"<=l&&l<="Z")return l.charCodeAt(0)-65+10;switch(l){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+l}};return o},$=function(w){const x=k.MODE_8BIT_BYTE,d=w,o=v.stringToBytes(w),s={};return s.getMode=function(){return x},s.getLength=function(l){return o.length},s.write=function(l){for(let e=0;e<o.length;e+=1)l.put(o[e],8)},s},W=function(w){const x=k.MODE_KANJI,d=w,o=v.stringToBytes;(function(e,t){const u=o(e);if(u.length!=2||(u[0]<<8|u[1])!=t)throw"sjis not supported."})("\u53CB",38726);const s=o(w),l={};return l.getMode=function(){return x},l.getLength=function(e){return~~(s.length/2)},l.write=function(e){const t=s;let u=0;for(;u+1<t.length;){let p=(255&t[u])<<8|255&t[u+1];if(33088<=p&&p<=40956)p-=33088;else if(57408<=p&&p<=60351)p-=49472;else throw"illegal char at "+(u+1)+"/"+p;p=(p>>>8&255)*192+(p&255),e.put(p,13),u+=2}if(u<t.length)throw"illegal char at "+(u+1)},l},Y=function(){const w=[],x={};return x.writeByte=function(d){w.push(d&255)},x.writeShort=function(d){x.writeByte(d),x.writeByte(d>>>8)},x.writeBytes=function(d,o,s){o=o||0,s=s||d.length;for(let l=0;l<s;l+=1)x.writeByte(d[l+o])},x.writeString=function(d){for(let o=0;o<d.length;o+=1)x.writeByte(d.charCodeAt(o))},x.toByteArray=function(){return w},x.toString=function(){let d="";d+="[";for(let o=0;o<w.length;o+=1)o>0&&(d+=","),d+=w[o];return d+="]",d},x},V=function(){let w=0,x=0,d=0,o="";const s={},l=function(t){o+=String.fromCharCode(e(t&63))},e=function(t){if(t<0)throw"n:"+t;if(t<26)return 65+t;if(t<52)return 97+(t-26);if(t<62)return 48+(t-52);if(t==62)return 43;if(t==63)return 47;throw"n:"+t};return s.writeByte=function(t){for(w=w<<8|t&255,x+=8,d+=1;x>=6;)l(w>>>x-6),x-=6},s.flush=function(){if(x>0&&(l(w<<6-x),w=0,x=0),d%3!=0){const t=3-d%3;for(let u=0;u<t;u+=1)o+="="}},s.toString=function(){return o},s},q=function(w){const x=w;let d=0,o=0,s=0;const l={};l.read=function(){for(;s<8;){if(d>=x.length){if(s==0)return-1;throw"unexpected end of file./"+s}const u=x.charAt(d);if(d+=1,u=="=")return s=0,-1;if(u.match(/^\s$/))continue;o=o<<6|e(u.charCodeAt(0)),s+=6}const t=o>>>s-8&255;return s-=8,t};const e=function(t){if(65<=t&&t<=90)return t-65;if(97<=t&&t<=122)return t-97+26;if(48<=t&&t<=57)return t-48+52;if(t==43)return 62;if(t==47)return 63;throw"c:"+t};return l},z=function(w,x){const d=w,o=x,s=new Array(w*x),l={};l.setPixel=function(p,y,h){s[y*d+p]=h},l.write=function(p){p.writeString("GIF87a"),p.writeShort(d),p.writeShort(o),p.writeByte(128),p.writeByte(0),p.writeByte(0),p.writeByte(0),p.writeByte(0),p.writeByte(0),p.writeByte(255),p.writeByte(255),p.writeByte(255),p.writeString(","),p.writeShort(0),p.writeShort(0),p.writeShort(d),p.writeShort(o),p.writeByte(0);const y=2,h=t(y);p.writeByte(y);let a=0;for(;h.length-a>255;)p.writeByte(255),p.writeBytes(h,a,255),a+=255;p.writeByte(h.length-a),p.writeBytes(h,a,h.length-a),p.writeByte(0),p.writeString(";")};const e=function(p){const y=p;let h=0,a=0;const _={};return _.write=function(P,D){if(P>>>D)throw"length over";for(;h+D>=8;)y.writeByte(255&(P<<h|a)),D-=8-h,P>>>=8-h,a=0,h=0;a=P<<h|a,h=h+D},_.flush=function(){h>0&&y.writeByte(a)},_},t=function(p){const y=1<<p,h=(1<<p)+1;let a=p+1;const _=u();for(let R=0;R<y;R+=1)_.add(String.fromCharCode(R));_.add(String.fromCharCode(y)),_.add(String.fromCharCode(h));const P=Y(),D=e(P);D.write(y,a);let E=0,m=String.fromCharCode(s[E]);for(E+=1;E<s.length;){const R=String.fromCharCode(s[E]);E+=1,_.contains(m+R)?m=m+R:(D.write(_.indexOf(m),a),_.size()<4095&&(_.size()==1<<a&&(a+=1),_.add(m+R)),m=R)}return D.write(_.indexOf(m),a),D.write(h,a),D.flush(),P.toByteArray()},u=function(){const p={};let y=0;const h={};return h.add=function(a){if(h.contains(a))throw"dup key:"+a;p[a]=y,y+=1},h.size=function(){return y},h.indexOf=function(a){return p[a]},h.contains=function(a){return typeof p[a]<"u"},h};return l},tt=function(w,x,d){const o=z(w,x);for(let t=0;t<x;t+=1)for(let u=0;u<w;u+=1)o.setPixel(u,t,d(u,t));const s=Y();o.write(s);const l=V(),e=s.toByteArray();for(let t=0;t<e.length;t+=1)l.writeByte(e[t]);return l.flush(),"data:image/gif;base64,"+l};return v})();

SGM_QR_FACTORY.stringToBytes = value => Array.from(new TextEncoder().encode(value));
const sgmQrSvgCache = new Map();
const getDeskQrSvg = (desk) => {
  const value = String(desk?.qrCode || '');
  if (!value) throw new Error('Bu masanın QR kodu yok.');
  if (sgmQrSvgCache.has(value)) return sgmQrSvgCache.get(value);
  const qr = SGM_QR_FACTORY(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const dimension = count + 8; // Okunabilirlik için dört modüllük beyaz kenar.
  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += 'M' + (col + 4) + ',' + (row + 4) + 'h1v1h-1z';
    }
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + dimension + '" height="' + dimension + '" viewBox="0 0 ' + dimension + ' ' + dimension + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="' + path + '" fill="black"/></svg>';
  if (sgmQrSvgCache.size >= 500) sgmQrSvgCache.clear();
  sgmQrSvgCache.set(value, svg);
  return svg;
};
const getDeskQrImageUrl = (desk, size = 600) => {
  const svg = getDeskQrSvg(desk).replace(/width="\d+" height="\d+"/, 'width="' + size + '" height="' + size + '"');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
};
const normalizeDeskQrRows = rows => (Array.isArray(rows) ? rows : [])
  .filter(desk => desk && Number.isInteger(Number(desk.id)) && Number(desk.id) > 0)
  .map(desk => ({ ...desk, id: Number(desk.id),
    // Mevcut QR aynen korunur. Eksik kod tüm cihazlarda aynı sonuçla tamamlanır.
    qrCode: desk.qrCode || ('QR-' + Number(desk.id) + '-SGM' + legacyIdentity(Number(desk.id)))
  }));

// Ana Salonun 35 masasını tamamlar; mevcut oturumlar ve QR kodları korunur.
const completeMainLibraryDesks = (rows, qrFallbackRows = []) => {
  const byId = new Map((Array.isArray(rows) ? rows : [])
    .filter(d => d && Number.isInteger(Number(d.id)) && Number(d.id) >= 1 && Number(d.id) <= 35)
    .map(d => [Number(d.id), d]));
  const qrById = new Map((Array.isArray(qrFallbackRows) ? qrFallbackRows : [])
    .filter(d => d && d.qrCode).map(d => [Number(d.id), d.qrCode]));
  return normalizeDeskQrRows(INITIAL_DESKS.map(defaultDesk => {
    const current = byId.get(defaultDesk.id);
    // Eski kayıtlardan yalnızca QR kurtarılır; eski dolu oturumlar yeniden açılmaz.
    return { ...(current || defaultDesk), id: defaultDesk.id,
      qrCode: current?.qrCode || qrById.get(defaultDesk.id) || '' };
  }));
};

const normalizeIdentityUsers = (rows) => {
  const assigned=new Map();const used=new Set();
  for(const u of [...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
    let identity=/^\d{8}$/.test(u.identityNo || '')?u.identityNo:legacyIdentity(u.id);
    while(used.has(identity))identity=String(10000000+(Number(identity)-10000000+1)%90000000);
    used.add(identity);assigned.set(u.id,identity);
  }
  // Mevcut GM kodlarını koru; kodu olmayan eski hesaba kalıcı ve benzersiz kod ata.
  const codes = new Map(); const usedCodes = new Set();
  const ordered = [...rows].sort((a,b) => String(a.id).localeCompare(String(b.id)));
  for (const u of ordered.filter(u => /^\d{8}$/.test(String(u.specialCode || '')))) {
    const code = String(u.specialCode);
    if (!usedCodes.has(code)) { codes.set(u.id, code); usedCodes.add(code); }
  }
  for (const u of ordered.filter(u => !codes.has(u.id))) {
    let code = assigned.get(u.id);
    while (usedCodes.has(code)) code = String(10000000 + (Number(code) - 10000000 + 1) % 90000000);
    codes.set(u.id, code); usedCodes.add(code);
  }
  return rows.map(({phone:oldPhone,...u})=>({...u,identityNo:assigned.get(u.id),specialCode:codes.get(u.id),
    ...(Number(u.activeDeskId)>35?{activeDeskId:null,activeDeskRole:null}:{}),
    ...(Number(u.pendingDeskId)>35?{pendingDeskId:null,pendingDeskDeadline:null}:{})}));
};
const INITIAL_USERS = [];
const DESK_RECLAIM_WAIT_MS = 30 * 60 * 1000;
const deskWaitRemaining = (user, at = Date.now()) => Math.max(0, Number(user?.deskReclaimAllowedAt || 0) - at);
const mergeDeskAccessPolicy = (local, remote) => {
  const newer = Number(local?.gmDeskAccessAt || 0) >= Number(remote?.gmDeskAccessAt || 0) ? local : remote;
  return newer ? {
    gmDeskAccessAt: Number(newer.gmDeskAccessAt || 0),
    deskReleasedAt: Number(newer.deskReleasedAt || 0),
    deskReclaimAllowedAt: Number(newer.deskReclaimAllowedAt || 0)
  } : {};
};
const normalizeRegistrationUrl = value => String(value || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
const mergeRegistrationSettings = (base = {}, incoming = {}) => {
  const baseUrl = normalizeRegistrationUrl(base.registrationFormUrl);
  const incomingUrl = normalizeRegistrationUrl(incoming.registrationFormUrl);
  // Kaydedilmiş bağlantı eski/boş bir snapshot veya açık başka bir cihaz tarafından silinmesin.
  const preserveBase = Number(base.registrationFormUpdatedAt || 0) > Number(incoming.registrationFormUpdatedAt || 0) ||
    (!!baseUrl && !incomingUrl && !Number(incoming.registrationFormUpdatedAt || 0));
  const chosen = preserveBase ? base : incoming;
  return { ...base, ...incoming,
    registrationFormUrl: normalizeRegistrationUrl(chosen.registrationFormUrl),
    registrationFormHistory: Array.isArray(chosen.registrationFormHistory) ? chosen.registrationFormHistory : [],
    registrationFormUpdatedAt: Number(chosen.registrationFormUpdatedAt || 0)
  };
};
const validRegistrationUrl = value => {
  try {
    const url = new URL(normalizeRegistrationUrl(value));
    return url.protocol === 'https:' && !url.username && !url.password &&
      ((url.hostname === 'docs.google.com' && url.pathname.startsWith('/forms/')) ||
       url.hostname === 'forms.gle');
  } catch { return false; }
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const isRestricted = (user, at = Date.now()) => user?.blocked === true || user?.pendingApproval === true || Number(user?.restrictedUntil || 0) > at;
const shouldRestoreReportPermission = (user, at = Date.now()) => Boolean(user) && !isRestricted(user, at) && user.canReport === false;
const lostDeskToday = (user, deskId) => user?.lostDeskDate === getLocalDayKey() && (user?.lostDeskIds || []).includes(Number(deskId));
const applyViolationPolicy = (user, deskId, at = Date.now()) => {
  const history = [...(Array.isArray(user.violationHistory) ? user.violationHistory : []), at];
  const recent = history.filter(t => Number(t) > at - WEEK_MS && Number(t) <= at);
  return {
    violationHistory: history,
    restrictedUntil: recent.length >= 2 ? Math.max(Number(user.restrictedUntil || 0), at + WEEK_MS) : Number(user.restrictedUntil || 0),
    restrictionReason: recent.length >= 2 ? 'Son 7 gün içinde iki ihlal: 7 gün kısıtlama' : (user.restrictionReason || ''),
    lostDeskDate: getLocalDayKey(new Date(at)),
    lostDeskIds: [...new Set([...(user.lostDeskDate === getLocalDayKey(new Date(at)) ? user.lostDeskIds || [] : []), Number(deskId)])]
  };
};

const generateDefaultLayout = () => {
 const e=[]; let n=0;
 const shape=(text,x,y,w,h,bg='#e2e8f0')=>e.push({id:'main-'+n++,type:'shape',area:'main',text,x,y,w,h,bg});
 const desk=(id,x,y,w,h,chair)=>e.push({id:'desk-'+id,type:'desk',area:'main',deskId:id,x,y,w,h,chair});
 e.push({id:'room-main',type:'room',area:'main',text:'Ana Salon'});
 shape('Kolon',30,90,65,65); shape('Pencere',5,175,15,375,'#cffafe'); shape('Pencere',5,595,15,185,'#cffafe');
 shape('Kitaplık',475,825,65,125,'#fed7aa'); shape('GİRİŞ',675,895,140,55,'#dcfce7');
 [13,12,11,10,9].forEach((id,i)=>desk(id,100+i*140,20,140,65,'bottom'));
 [8,7,6,5,4,3,2,1].forEach((id,i)=>desk(id,800,115+i*88,75,88,'left'));
 [14,15,16,17].forEach((id,i)=>desk(id,30,175+i*100,75,100,'right'));
 [18,19,20].forEach((id,i)=>desk(id,30,600+i*65,115,65,'right'));
 [21,22,23].forEach((id,i)=>desk(id,30+i*145,875,145,75,'top'));
 [[34,35,32,33],[30,31,28,29],[26,27,24,25]].forEach((ids,k)=>ids.forEach((id,i)=>desk(id,350+(i%2)*100,195+k*225+Math.floor(i/2)*75,100,75,i%2?'right':'left')));
 return e;
};

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("React Error Boundary Caught:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl max-w-lg w-full shadow-2xl space-y-4 border-l-8 border-red-500">
            <h2 className="text-2xl font-black text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-8 h-8" /> Kritik Bir Hata Oluştu
            </h2>
            <p className="text-slate-600">Sistem çalışırken beklenmeyen bir durumla karşılaştı. Uygulamanın çökmesini engelledik ancak sayfayı yenilemeniz gerekebilir.</p>
            <div className="bg-slate-100 p-4 rounded-xl text-xs font-mono text-slate-700 overflow-x-auto">
              <strong>Hata Detayı:</strong><br/>
              {this.state.error && this.state.error.toString()}
            </div>
            <button onClick={() => window.location.reload()} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">
              Sistemi Yeniden Yükle
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const Modal = ({ isOpen, onClose, title, children, type = 'info' }) => {
  if (!isOpen) return null;
  const colors = {
    info: 'text-blue-600 bg-blue-50',
    warning: 'text-yellow-600 bg-yellow-50',
    danger: 'text-red-600 bg-red-50',
    success: 'text-green-600 bg-green-50'
  };
  const Icon = type === 'danger' || type === 'warning' ? AlertTriangle : type === 'success' ? CheckCircle : Info;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[120]">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${colors[type]}`}>
              <Icon className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

const ScannerModal = ({ isOpen, onClose, title, onScan, autoSubmit = false }) => {
  const [scannedData, setScannedData] = useState(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const scannerRef = useRef(null);

  useEffect(() => {
    if (!document.getElementById('html5-qrcode-script')) {
      const script = document.createElement('script');
      script.id = 'html5-qrcode-script';
      script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
      script.async = true;
      script.onload = () => setScriptLoaded(true);
      document.body.appendChild(script);
    } else {
      setScriptLoaded(true);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (isOpen && scriptLoaded && !scannedData) {
      const timer = setTimeout(() => {
        if (!isMounted || !document.getElementById('reader')) return;
        
        try {
          // Eğer önceden kalma bir scanner varsa temizle
          if (scannerRef.current && scannerRef.current.isScanning) {
             scannerRef.current.stop().catch(e => console.warn(e));
          }

          const html5QrCode = new window.Html5Qrcode("reader");
          scannerRef.current = html5QrCode;

          html5QrCode.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 220, height: 220 },
              aspectRatio: 1.0,
            },
            (decodedText) => {
              if (!isMounted) return;

              // İhbar sonrası "Masadayım" doğrulamasında QR algılanır algılanmaz işlemi tamamla.
              // Böylece kullanıcı ikinci kez "Evet, Doğru" butonuna basmak zorunda kalmaz ve
              // 1 saniyelik süre kontrolü ile doğrulama arasında yarış oluşmaz.
              if (autoSubmit) {
                isMounted = false;
                if (scannerRef.current) {
                  scannerRef.current.stop().catch(e => console.warn(e));
                }
                onScan(decodedText);
                return;
              }

              setScannedData(decodedText);
              if (scannerRef.current) {
                scannerRef.current.stop().catch(e => console.warn(e));
              }
            },
            (errorMessage) => {
              // Ignore scan iteration errors silently
            }
          ).catch((err) => {
            console.warn("Kamera başlatılamadı:", err);
          });
        } catch (error) {
          console.error("QR Motoru Hatası:", error);
        }
      }, 500); // Mobilde çökmeyi önlemek için timer süresi 500ms yapıldı.

      return () => {
        isMounted = false;
        clearTimeout(timer);
      };
    }

    return () => {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop().then(() => {
              if (scannerRef.current) scannerRef.current.clear();
            }).catch(e => console.warn(e));
          }
        } catch (e) {}
        scannerRef.current = null;
      }
    };
  }, [isOpen, scriptLoaded, scannedData, autoSubmit]);

  useEffect(() => {
    if (!isOpen) {
      setScannedData(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const parsedDeskId = scannedData ? scannedData.split('-')[1] : null;

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-[110]">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-2">
            <QrCode className="w-6 h-6 text-blue-600" />
            <h3 className="font-bold text-slate-800 text-lg">{title || "QR Kod Okut"}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="relative w-full h-80 bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center shadow-inner">
            {scannedData ? (
              <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-6 text-center z-20">
                <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mb-4 shadow-lg shadow-blue-500/50">
                  <CheckCircle className="text-white w-10 h-10" />
                </div>
                <p className="text-slate-300 mb-2 text-sm">QR Kod Algılandı</p>
                <p className="text-white mb-6 text-lg">
                  Masa <span className="font-black text-blue-400 text-3xl px-2">{parsedDeskId || "?"}</span> doğru mu?
                </p>
                <div className="flex gap-3 w-full">
                  <button onClick={() => setScannedData(null)} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-colors">Tekrar Okut</button>
                  <button onClick={() => onScan(scannedData)} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors shadow-md">Evet, Doğru</button>
                </div>
              </div>
            ) : (
              <>
                {!scriptLoaded && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-4 text-center">
                    <Camera className="w-12 h-12 text-slate-500 mb-2 animate-pulse" />
                    <p className="text-sm text-slate-300">Motor yükleniyor...</p>
                  </div>
                )}
                <div id="reader" className="w-full h-full object-cover"></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Eski sabit KrokiMap kaldırıldı; tek aktif kroki DynamicKrokiMap üzerinden çalışır.

const DynamicKrokiMap = ({ desks, layoutElements, onDeskClick, myDeskId, isPublic = false, isAdmin = false, area = 'all' }) => {
  const getDesk = (id) => desks.find((d) => Number(d.id) === Number(id));

  // Editörde kaydedilen tek kroki içinde Ana Salon (1-44) ve Ana Salon (45-56)
  // ayrı ayrı gösterilebilsin. Eski kayıtlarla uyumluluk için area alanı olmayan şekillerde
  // koordinata göre mevcut varsayılan ayrım korunur.
  const isElementVisibleForArea = (el) => {
      if (el?.type === 'room') return false;
      if (area === 'all') return true;

      if (el?.area) {
          return el.area === area;
      }

      if (el?.type === 'desk') {
          const deskId = Number(el.deskId);
          if (area === 'main') return deskId >= 1 && deskId <= 44;
          if (area === 'blue') return deskId >= 45 && deskId <= 56;
      }

      // Önceden oluşturulmuş şekillerde area bilgisi yoksa mevcut varsayılan
      // kroki koordinatına göre Ana Salon solda, Ana Salon sağda kabul edilir.
      const x = Number(el?.x || 0);
      return area === 'blue' ? x < 450 : x >= 450;
  };

  const visibleLayoutElements = (Array.isArray(layoutElements) ? layoutElements : [])
      .filter(isElementVisibleForArea);

  return (
    <div className="relative w-full h-[600px] sm:h-[800px] bg-slate-50 overflow-auto border-2 border-slate-300 rounded-2xl custom-scrollbar shadow-inner">
       <div className="relative w-[900px] h-[1000px] bg-white bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px]">
          {visibleLayoutElements.map(el => {
              if (el.type === 'desk') {
                  const desk = getDesk(el.deskId);
                  
                  let statusClasses = 'bg-slate-200 text-slate-400 border-slate-300 opacity-60';
                  if (desk) {
                      const isMyDesk = desk.id === myDeskId;
                      const isReserved = !!(desk.pendingOccupant && Number(desk.pendingDeskDeadline || 0) > Date.now());
                      if (isMyDesk) statusClasses = 'bg-blue-600 text-white border-blue-700 shadow-lg ring-2 ring-blue-300 z-10 scale-110';
                      else if (isReserved) statusClasses = 'bg-purple-500 text-white border-purple-700 shadow-md';
                      else if (desk.status === 'available') statusClasses = 'bg-white text-slate-700 hover:bg-slate-50 border-slate-400';
                      else if (desk.status === 'occupied') statusClasses = 'bg-red-500 text-white border-red-700 hover:bg-red-600';
                      else if (desk.status === 'on_break') statusClasses = 'bg-yellow-400 text-yellow-900 border-yellow-600';
                      else if (desk.status === 'reported') statusClasses = 'bg-orange-500 text-white border-orange-700 animate-pulse';
                  }
                  
                  return (
                      <button
                        key={el.id}
                        onClick={() => desk && onDeskClick && onDeskClick(desk)}
                        disabled={isPublic || (desk && !isAdmin && desk.status === 'disabled')}
                        style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
                        className={`absolute flex flex-col items-center justify-center font-bold border transition-all ${statusClasses} ${!isPublic && desk && 'cursor-pointer'} ${isPublic && 'cursor-default'}`}
                      >
                        {el.chair && <span aria-hidden="true" style={{position:'absolute',background:'#334155',borderRadius:8,width:['left','right'].includes(el.chair)?20:42,height:['left','right'].includes(el.chair)?42:20,...(el.chair==='left'?{left:-22,top:'22%'}:el.chair==='right'?{right:-22,top:'22%'}:el.chair==='top'?{top:-22,left:'32%'}:{bottom:-22,left:'32%'})}}/>}
                        <span className="text-base sm:text-lg leading-none">{el.deskId}</span>
                        {desk && (isPublic || (desk.pendingOccupant && Number(desk.pendingDeskDeadline || 0) > Date.now())) && (
                            <span className="text-[9px] uppercase opacity-90 mt-0.5 leading-none tracking-tighter">
                                {(desk.pendingOccupant && Number(desk.pendingDeskDeadline || 0) > Date.now()) ? 'REZERVE' : desk.status === 'available' ? 'BOŞ' : desk.status === 'occupied' ? 'DOLU' : desk.status === 'on_break' ? 'MOLA' : desk.status === 'reported' ? 'KONTROL' : 'KAPALI'}
                            </span>
                        )}
                      </button>
                  );
              } else {
                  return (
                      <div key={el.id} style={{ left: el.x, top: el.y, width: el.w, height: el.h, backgroundColor: el.bg || '#fef3c7' }} className="absolute flex items-center justify-center text-sm font-bold text-slate-800 border-2 border-slate-800 shadow-md pointer-events-none text-center px-1 overflow-hidden">
                          {el.text}
                      </div>
                  );
              }
          })}
       </div>
    </div>
  );
};

const LayoutEditor = ({ initialElements, onSave }) => {
  const normalize = (items) => {
    const arr = Array.isArray(items) ? items.map(el => ({ ...el })) : [];
    const hasRooms = arr.some(el => el.type === 'room');
    if (hasRooms) return arr;
    return generateDefaultLayout();
  };
  const [elements, setElements] = useState(() => normalize(initialElements));
  const [selectedId, setSelectedId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeArea, setActiveArea] = useState('main');
  const canvasRef = useRef(null);

  useEffect(() => {
    const next = normalize(initialElements);
    setElements(next);
    setSelectedId(null);
    const rooms = next.filter(el => el.type === 'room');
    if (!rooms.some(r => r.area === activeArea)) setActiveArea(rooms[0]?.area || 'main');
  }, [initialElements]);

  const rooms = elements.filter(el => el.type === 'room');
  const selectedElement = elements.find(el => el.id === selectedId);
  const visibleElements = elements.filter(el => el.type !== 'room' && (el.area || 'main') === activeArea);
  const activeRoom = rooms.find(r => r.area === activeArea);

  const addRoom = () => {
    const name = window.prompt('Yeni oda adı nedir?');
    if (!name || !name.trim()) return;
    const area = 'room-' + generateId();
    setElements(prev => [...prev, { id: generateId(), type: 'room', area, text: name.trim() }]);
    setActiveArea(area);
    setSelectedId(null);
  };

  const handleAddDesk = () => {
    const maxId = elements.reduce((max, el) => el.type === 'desk' ? Math.max(max, Number(el.deskId) || 0) : max, 0);
    setElements(prev => [...prev, { id: generateId(), type: 'desk', area: activeArea, deskId: maxId + 1, x: 100, y: 100, w: 72, h: 58 }]);
  };
  const handleAddShape = () => setElements(prev => [...prev, { id: generateId(), type: 'shape', area: activeArea, text: 'Kitaplık', bg: '#fef3c7', x: 220, y: 120, w: 140, h: 45 }]);
  const resetOfficial = () => {
    if (!window.confirm('Eski kroki editörü tamamen sıfırlanacak ve verdiğiniz Ana Salon + Ana Salon krokileri yüklenecek. Devam edilsin mi?')) return;
    const next = generateDefaultLayout();
    setElements(next); setActiveArea('main'); setSelectedId(null);
  };
  const deleteRoom = () => {
    if (activeArea === 'main' || activeArea === 'blue') return;
    if (!window.confirm(`${activeRoom?.text || 'Bu oda'} ve içindeki tüm kroki öğeleri silinsin mi?`)) return;
    setElements(prev => prev.filter(el => el.area !== activeArea));
    setActiveArea('main'); setSelectedId(null);
  };
  const updateSelected = (key, value) => setElements(prev => prev.map(el => el.id === selectedId ? { ...el, [key]: value } : el));
  const handleDeleteSelected = () => { setElements(prev => prev.filter(el => el.id !== selectedId)); setSelectedId(null); };
  const handleMouseDown = (e,id) => {
    if (e.button !== 0 || !canvasRef.current) return;
    e.stopPropagation(); const rect=canvasRef.current.getBoundingClientRect(); const el=elements.find(x=>x.id===id); if(!el)return;
    setDragStart({x:e.clientX-rect.left-el.x,y:e.clientY-rect.top-el.y}); setDraggingId(id); setSelectedId(id);
  };
  const handleMouseMove = (e) => {
    if (!draggingId || !canvasRef.current) return;
    const rect=canvasRef.current.getBoundingClientRect();
    const x=Math.max(0,Math.round((e.clientX-rect.left-dragStart.x)/10)*10); const y=Math.max(0,Math.round((e.clientY-rect.top-dragStart.y)/10)*10);
    setElements(prev=>prev.map(el=>el.id===draggingId?{...el,x,y}:el));
  };

  return (
    <div className="bg-slate-50">
      <div className="p-4 bg-white border-b border-slate-200 flex flex-wrap items-center gap-2">
        {rooms.map(room => <button key={room.id} onClick={()=>{setActiveArea(room.area);setSelectedId(null)}} className={`px-4 py-2 rounded-xl font-bold text-sm ${activeArea===room.area?'bg-blue-600 text-white':'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{room.text}</button>)}
        <button onClick={addRoom} className="px-4 py-2 rounded-xl font-bold text-sm bg-emerald-100 text-emerald-700 hover:bg-emerald-200 flex items-center gap-1"><Plus className="w-4 h-4"/> Yeni Oda</button>
        {activeArea!=='main' && activeArea!=='blue' && <button onClick={deleteRoom} className="px-4 py-2 rounded-xl font-bold text-sm bg-red-100 text-red-700 hover:bg-red-200"><Trash2 className="w-4 h-4 inline mr-1"/> Odayı Sil</button>}
      </div>
      <div className="flex flex-col md:flex-row h-[720px] select-none">
        <div className="w-full md:w-80 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-200 space-y-3">
            <h3 className="font-black text-slate-800">{activeRoom?.text || 'Kroki'} Araçları</h3>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleAddDesk} className="py-2 bg-blue-100 text-blue-700 rounded-lg font-bold text-sm"><Plus className="w-4 h-4 inline"/> Masa</button>
              <button onClick={handleAddShape} className="py-2 bg-amber-100 text-amber-700 rounded-lg font-bold text-sm"><Plus className="w-4 h-4 inline"/> Şekil</button>
            </div>
            <button onClick={resetOfficial} className="w-full py-2 bg-slate-200 text-slate-700 rounded-lg font-bold text-sm flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4"/> Verdiğim Krokilere Sıfırla</button>
            <button onClick={()=>onSave(elements)} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold flex items-center justify-center gap-2"><Save className="w-5 h-5"/> Tüm Odaları Kaydet</button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto">
            <h4 className="font-bold text-slate-700 mb-4 text-sm border-b pb-2">Öğe Özellikleri</h4>
            {selectedElement ? <div className="space-y-4">
              {selectedElement.type==='desk' ? <div><label className="block text-xs font-bold text-slate-500 mb-1">Masa Numarası</label><input type="number" value={selectedElement.deskId} onChange={e=>updateSelected('deskId',parseInt(e.target.value)||1)} className="w-full p-2 border rounded-lg"/></div> : <>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">Metin</label><input value={selectedElement.text||''} onChange={e=>updateSelected('text',e.target.value)} className="w-full p-2 border rounded-lg"/></div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">Renk</label><input type="color" value={selectedElement.bg||'#fef3c7'} onChange={e=>updateSelected('bg',e.target.value)} className="w-full h-10"/></div>
              </>}
              <div className="grid grid-cols-2 gap-2"><input type="number" value={selectedElement.w} onChange={e=>updateSelected('w',parseInt(e.target.value)||20)} className="p-2 border rounded-lg"/><input type="number" value={selectedElement.h} onChange={e=>updateSelected('h',parseInt(e.target.value)||20)} className="p-2 border rounded-lg"/></div>
              <button onClick={handleDeleteSelected} className="w-full py-2 bg-red-100 text-red-700 rounded-lg font-bold"><Trash2 className="w-4 h-4 inline mr-1"/> Öğeyi Sil</button>
            </div> : <p className="text-sm text-slate-400">Düzenlemek için krokiden bir öğe seçin.</p>}
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-200" onMouseUp={()=>setDraggingId(null)} onMouseLeave={()=>setDraggingId(null)}>
          <div ref={canvasRef} onMouseMove={handleMouseMove} onClick={()=>setSelectedId(null)} className="relative w-[900px] h-[1000px] bg-white bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] shadow-sm m-8 rounded-xl overflow-hidden cursor-crosshair">
            {visibleElements.map(el=><div key={el.id} onMouseDown={e=>handleMouseDown(e,el.id)} onClick={e=>{e.stopPropagation();setSelectedId(el.id)}} style={{left:el.x,top:el.y,width:el.w,height:el.h,backgroundColor:el.type==='shape'?(el.bg||'#fef3c7'):undefined}} className={`absolute flex items-center justify-center border-2 border-slate-800 cursor-grab ${selectedId===el.id?'ring-4 ring-blue-400 z-20':'shadow-sm z-10'} ${el.type==='desk'?'bg-slate-100 font-bold':'font-bold text-sm'}`}>{el.type==='desk'?el.deskId:el.text}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
};

const ReportForm = ({ deskId, onSubmit, onCancel, reporter }) => {
  const reporterName = reporter?.name || '';
  const reporterIdentityNo = reporter?.specialCode || '';

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!reporterName || !reporterIdentityNo) return;
      onSubmit(deskId, reporterName, reporterIdentityNo);
    }} className="space-y-4">
      <p className="text-sm text-slate-600">Masa <b>{deskId}</b> numarasında kimsenin bulunmadığını onaylıyor musunuz?</p>

      <div className="bg-red-50 p-3 rounded-lg text-xs text-red-700 border border-red-200">
        <strong>Dikkat:</strong> Asılsız ihbar yapmak kural ihlalidir. Güvenlik ve log kayıtları için bilgileriniz tutulmaktadır.
      </div>

      <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700 border border-blue-200">
        İhbar, <strong>sisteme giriş yapan kullanıcı</strong> adına gönderilecektir. Ad-soyad ve GM Özel Kodunuzu tekrar girmeniz gerekmez.
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500 font-bold">İhbar Eden</span>
          <span className="text-slate-800 font-black text-right">{reporterName || 'Kullanıcı bilgisi bulunamadı'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500 font-bold">GM Özel Kod</span>
          <span className="font-mono font-black tracking-widest text-slate-800">{reporterIdentityNo || '-'}</span>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold transition-colors">İptal</button>
        <button type="submit" disabled={!reporterName || !reporterIdentityNo} className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-md transition-colors">
          Onaylıyorum, Bildir
        </button>
      </div>
    </form>
  );
};

function MainApp() {
  const pendingUserCreatesRef = useRef(new Set());
  const serverDeletedUserIdsRef = useRef(new Set());
  const pendingUserDeletesRef = useRef((() => { try { return new Set(JSON.parse(localStorage.getItem('sgm_pending_user_deletes') || '[]')); } catch { return new Set(); } })());
  const appendOutboxRef = useRef(null);
  const appendChainRef = useRef(Promise.resolve());
  const expiredDeskJobsRef = useRef(new Set());
  const deskActionInFlightRef = useRef(false);
  const [syncRetryEpoch, setSyncRetryEpoch] = useState(0);
  const [adminAuthorized, setAdminAuthorized] = useState(false);
  const verifiedAdminUidRef = useRef(null);
  const [studentMessages, setStudentMessages] = useState([]);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const feedbackInFlightRef = useRef(false);


  const [view, setView] = useState('permission_gate');
  const [registrationPending, setRegistrationPending] = useState(() => sessionStorage.getItem('sgm_registration_token') || '');
  const [registrationResult, setRegistrationResult] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('sgm_registration_credentials') || 'null'); } catch { return null; }
  });
  const [registrationFormUrl, setRegistrationFormUrl] = useState(() => sessionStorage.getItem('sgm_registration_form_url') || '');
  const [registrationFormOpened, setRegistrationFormOpened] = useState(() => sessionStorage.getItem('sgm_registration_form_opened') === '1');
  const [registrationError, setRegistrationError] = useState('');
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationAccepted, setRegistrationAccepted] = useState(false);
  const [registrationRulesOpen, setRegistrationRulesOpen] = useState(false);
  const [permissionsState, setPermissionsState] = useState('idle');
  const [batteryGuidanceOpen, setBatteryGuidanceOpen] = useState(false);
  const [wakeLockStatus, setWakeLockStatus] = useState('idle');
  const wakeLockRef = useRef(null);
  const wakeLockWantedRef = useRef(false);
  const registrationInFlightRef = useRef(false);
  const adminCreateRequestRef = useRef(null);
  const [adminCreatingUser, setAdminCreatingUser] = useState(false);
  
  const [loginIdentity, setLoginIdentity] = useState('');
  const [loginPin, setLoginPin] = useState('');
  
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('sgm_settings');
    return saved ? {...DEFAULT_SETTINGS,...JSON.parse(saved),showBlueRoomKroki:false} : DEFAULT_SETTINGS;
  });
  
  const settingsRef = useRef(settings);
  const [registrationLinkSaving, setRegistrationLinkSaving] = useState(false);
  const [systemSettingsSaving, setSystemSettingsSaving] = useState(false);
  const systemSettingsSavingRef = useRef(false);
  const [registrationRedirectBusy, setRegistrationRedirectBusy] = useState(false);
  const registrationRedirectInFlightRef = useRef(false);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const [desks, setDesks] = useState(() => {
    const saved = localStorage.getItem('sgm_desks');
    try {
      const rows = saved ? JSON.parse(saved) : INITIAL_DESKS;
      const normalized = normalizeDeskQrRows(rows).filter(d => Number(d.id) <= 35);
      return normalized.length ? normalized : INITIAL_DESKS;
    } catch {
      return INITIAL_DESKS;
    }
  });
  
  const [users, setUsers] = useState(() => {
    const saved = localStorage.getItem('sgm_users');
    return saved ? normalizeIdentityUsers(JSON.parse(saved)) : INITIAL_USERS;
  });
  
  const [logs, setLogs] = useState(() => {
    const saved = localStorage.getItem('sgm_logs');
    return saved ? JSON.parse(saved) : [];
  });

  // Günlük ihlal sayacından bağımsız, kalıcı ihlal geçmişi.
  const [violationRecords, setViolationRecords] = useState(() => {
    const saved = localStorage.getItem('sgm_violation_records');
    return saved ? JSON.parse(saved) : [];
  });

  // Uygulama hakkında kullanıcıların ilettiği öneri ve şikayet kayıtları.
  const [feedbackRecords, setFeedbackRecords] = useState(() => {
    const saved = localStorage.getItem('sgm_feedback_records');
    return saved ? JSON.parse(saved) : [];
  });

  const [feedbackForm, setFeedbackForm] = useState({ name: '', identityNo: '', type: '', message: '' });
  const [feedbackStep, setFeedbackStep] = useState(1);

  const [layoutElements, setLayoutElements] = useState(() => {
    const saved = localStorage.getItem('sgm_layout');
    const version = Number(localStorage.getItem('sgm_layout_schema_version') || 0);
    if (version < 3) {
      const fresh = generateDefaultLayout();
      localStorage.setItem('sgm_layout', JSON.stringify(fresh));
      localStorage.setItem('sgm_layout_schema_version', '3');
      return fresh;
    }
    try {
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : generateDefaultLayout();
    } catch (e) {
      return generateDefaultLayout();
    }
  });

  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [fbUser, setFbUser] = useState(null);
  const remoteDataRef = useRef(null);
  const isInitializingRef = useRef(true);

  // FIRESTORE ECHO / PING-PONG KORUMASI:
  // onSnapshot ile uzaktan gelen state ekrana uygulandıktan sonra aynı state'in
  // bu cihaz tarafından tekrar Firestore'a yazılmasını engeller.
  // Böylece telefon ve yönetici paneli eski BOŞ/DOLU durumlarını birbirine geri basmaz.
  const lastRemoteAppliedLocalStrRef = useRef(null);

  // Masa alma, bırakma ve rezervasyon gibi kritik yerel işlemler snapshot ile aynı anda
  // gerçekleşirse bile Firestore'a en az bir kez yazılmasını garanti eder.
  const criticalDeskMutationRef = useRef(false);

  // KRİTİK DÜZELTME: Render döngülerinde referans sorunları yaşamamak için Ref'ler kullanılıyor.
  const desksRef = useRef(desks);
  const usersRef = useRef(users);
  // Kayıtların Firestore'dan gelen eski snapshot tarafından ezilmesini önlemek için güncel log referansı.
  const logsRef = useRef(logs);
  
  const violationRecordsRef = useRef(violationRecords);
  const feedbackRecordsRef = useRef(feedbackRecords);
  const layoutElementsRef = useRef(layoutElements);

  // SİLİNEN KAYIT SENKRON KORUMASI:
  // Firestore'dan gecikmiş/eski snapshot geldiğinde yönetici tarafından silinen kayıtların
  // yeniden listeye eklenmesini engeller. Kimlikler localStorage'da da tutulduğu için
  // sekme değiştirme / sayfa yenileme sonrasında eski snapshot kaydı geri getiremez.
  const deletedRecordIdsRef = useRef({
    users: new Set(JSON.parse(localStorage.getItem('sgm_deleted_user_ids') || '[]')),
    logs: new Set(JSON.parse(localStorage.getItem('sgm_deleted_log_ids') || '[]')),
    violations: new Set(JSON.parse(localStorage.getItem('sgm_deleted_violation_ids') || '[]')),
    feedback: new Set(JSON.parse(localStorage.getItem('sgm_deleted_feedback_ids') || '[]'))
  });

  const rememberDeletedRecordId = (bucket, id) => {
    if (!id || !deletedRecordIdsRef.current?.[bucket]) return;
    const bucketSet = deletedRecordIdsRef.current[bucket];
    bucketSet.add(String(id));

    // Çok büyümemesi için en son 5000 silinen kimliği sakla.
    const trimmed = Array.from(bucketSet).slice(-5000);
    deletedRecordIdsRef.current[bucket] = new Set(trimmed);

    const storageKeys = {
      users: 'sgm_deleted_user_ids',
      logs: 'sgm_deleted_log_ids',
      violations: 'sgm_deleted_violation_ids',
      feedback: 'sgm_deleted_feedback_ids'
    };

    try {
      localStorage.setItem(storageKeys[bucket], JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Silinen kayıt koruması localStorage yazılamadı:', e);
    }
  };

  const isRecordDeleted = (bucket, id) => {
    if (!id) return false;
    return deletedRecordIdsRef.current?.[bucket]?.has(String(id)) === true;
  };

  const restoreDeletedRecordProtectionFromSnapshot = (snapshot) => {
    const groups = {
      users: Array.isArray(snapshot?.users) ? snapshot.users : [],
      logs: [...(snapshot?.logs || []), ...(snapshot?.archivedLogs || [])],
      violations: Array.isArray(snapshot?.violationRecords) ? snapshot.violationRecords : [],
      feedback: Array.isArray(snapshot?.feedbackRecords) ? snapshot.feedbackRecords : []
    };
    const storageKeys = {
      users: 'sgm_deleted_user_ids',
      logs: 'sgm_deleted_log_ids',
      violations: 'sgm_deleted_violation_ids',
      feedback: 'sgm_deleted_feedback_ids'
    };
    Object.entries(groups).forEach(([bucket, records]) => {
      const set = deletedRecordIdsRef.current?.[bucket];
      if (!set) return;
      records.forEach(record => { if (record?.id) set.delete(String(record.id)); });
      try { localStorage.setItem(storageKeys[bucket], JSON.stringify(Array.from(set))); } catch (e) {}
    });
  };

  // QR ile başarıyla başlayan masa oturumunun eski/gecikmiş Firestore snapshot'ı tarafından
  // birkaç saniye içinde geri alınmasını engelleyen kısa süreli senkronizasyon koruması.
  const confirmedDeskGuardRef = useRef(null);

  // MASA BIRAKMA SENKRON KORUMASI:
  // Öğrenci masayı bıraktıktan hemen sonra Firestore'dan birkaç saniye gecikmiş
  // "masa hâlâ dolu" snapshot'ı gelirse masanın yeniden dolu görünmesini engeller.
  // Özellikle yönetici panelindeki BOŞ / ÖĞRENCİ MASADA yanıp sönmesini keser.
  const releasedDeskGuardRef = useRef(null);

  // Geçerli 5 dakikalık masa rezervasyonunu gecikmiş Firestore snapshot'ından korur.
  const pendingReservationGuardRef = useRef(null);

  // GÜN SONU / MANUEL SIFIRLAMA SENKRON KORUMASI:
  // 22:00 veya yönetici tarafından yapılan tam temizlikten hemen sonra gecikmiş
  // Firestore snapshot'ının masaları tekrar DOLU/REZERVE göstermesini engeller.
  const dayEndCleanupGuardRef = useRef(null);

  // KROKİ EDİTÖRÜ SENKRON KORUMASI:
  // Yönetici yeni krokiyi kaydettikten hemen sonra gecikmiş eski Firestore snapshot'ı
  // gelirse yeni düzenin eski düzenle geri ezilmesini engeller.
  const layoutSaveGuardRef = useRef(null);

  useEffect(() => {
    desksRef.current = desks;
    usersRef.current = users;
    logsRef.current = logs;
    violationRecordsRef.current = violationRecords;
    feedbackRecordsRef.current = feedbackRecords;
    layoutElementsRef.current = layoutElements;
  }, [desks, users, logs, violationRecords, feedbackRecords, layoutElements]);

  const [currentUser, setCurrentUser] = useState(null);
  const [now, setNow] = useState(Date.now());
  const sessionRestoredRef = useRef(false);
  const missingSessionUserSinceRef = useRef(0);
  useEffect(() => {
    if (!isDataLoaded || sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem('sgm_student_session') || 'null');
      const user = (Array.isArray(users) ? users : []).find(u => u.id === saved?.userId);
      if (sessionCanRestore(saved, user)) {
        setCurrentUser(user);
        const pending = Number(user.pendingDeskDeadline || 0) > Date.now();
        setSelectedDeskId(pending ? user.pendingDeskId : null);
        setDeskSelectionDeadline(pending ? user.pendingDeskDeadline : null);
        setView('student_dash');
      } else sessionStorage.removeItem('sgm_student_session');
    } catch { sessionStorage.removeItem('sgm_student_session'); }
  }, [isDataLoaded, users]);
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    if (currentUser) sessionStorage.setItem('sgm_student_session', JSON.stringify({userId: currentUser.id, day: getLocalDayKey()}));
    // null ilk renderda da oluşur; kayıt yalnızca açık çıkış / hesap silinmesinde temizlenir.
  }, [currentUser, isDataLoaded]);
  useEffect(() => {
    if (!currentUser || !isDataLoaded) return;
    const user = (Array.isArray(users) ? users : []).find(u => u.id === currentUser.id);
    if (!user) {
      // Gecikmiş / geçici boş snapshot aktif oturumu hemen kapatmasın.
      if (!missingSessionUserSinceRef.current) missingSessionUserSinceRef.current = Date.now();
      // A failed/cache-only snapshot is not evidence of deletion.
      if (!isRecordDeleted('users', currentUser.id) && !serverDeletedUserIdsRef.current.has(String(currentUser.id))) return;
      sessionStorage.removeItem('sgm_student_session');
      setCurrentUser(null); setView('student_login');
      setSelectedDeskId(null); setDeskSelectionDeadline(null);
      return;
    }

    missingSessionUserSinceRef.current = 0;
    // YP'den onay/kısıt değiştiğinde açık öğrenci oturumundaki eski kullanıcı
    // nesnesini de güncelle. Böylece pendingApproval=false anında QR işlemine yansır.
    setCurrentUser(prev => {
      if (!prev || prev.id !== user.id) return prev;
      const sameApproval = prev.pendingApproval === user.pendingApproval;
      const sameRestriction = Number(prev.restrictedUntil || 0) === Number(user.restrictedUntil || 0);
      const sameBlocked = prev.blocked === user.blocked;
      const sameReason = (prev.restrictionReason || '') === (user.restrictionReason || '');
      if (sameApproval && sameRestriction && sameBlocked && sameReason && JSON.stringify(prev) === JSON.stringify(user)) return prev;
      return { ...prev, ...user };
    });
  }, [now, users, isDataLoaded, currentUser?.id]);
  // ÖĞRENCİ MASA SEÇİMİ: Öğrenci önce masasını seçer, ardından 5 dakika içinde aynı masanın QR kodunu okutmalıdır.
  const [selectedDeskId, setSelectedDeskId] = useState(null);
  const [deskSelectionDeadline, setDeskSelectionDeadline] = useState(null);
  const deviceId = useMemo(() => getDeviceId(), []);
  const [userLocation, setUserLocation] = useState(() => localStorage.getItem('sgm_last_location') || "Konum Aranıyor...");

  const [modal, setModal] = useState({ isOpen: false, type: '', title: '', content: null, onClose: null });
  const [scannerConfig, setScannerConfig] = useState({ isOpen: false, mode: null, title: '' }); 
  const [adminTab, setAdminTab] = useState('desks');
  // Yönetici toplu işlemleri, dağıtım kodu ve geri alma geçmişi.
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  // Toplu QR ekranında hangi masaların alınacağını/yazdırılacağını seçer.
  const [selectedQrDeskIds, setSelectedQrDeskIds] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archivedLogs, setArchivedLogs] = useState([]);
  const archiveCursorRef = useRef({ sgmAudit: null, sgmLogs: null });
  const [bulkRestrictionDays, setBulkRestrictionDays] = useState(5);
  const [selectedLogIds, setSelectedLogIds] = useState([]);
  const [selectedViolationIds, setSelectedViolationIds] = useState([]);
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  // Halka açık ekran, öğrenci ekranı ve yönetici krokisinde hangi alanın açık olduğunu tutar.
  const [publicKrokiArea, setPublicKrokiArea] = useState('main');
  const [studentKrokiArea, setStudentKrokiArea] = useState('main');
  const [adminKrokiArea, setAdminKrokiArea] = useState('main');
  // Yönetici menüsü varsayılan olarak SGM Admin başlığının içinde gizlidir.
  // SGM Admin alanına tıklanınca sekmeler soldan aşağı doğru açılır/kapanır.
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  // Kullanıcılar ekranından açılan öğrenci düzenleme penceresinde seçili kullanıcıyı tutar.
  const [adminUserEditId, setAdminUserEditId] = useState(null);
  const [reportFormContext, setReportFormContext] = useState(null);
  const [liveDeskId, setLiveDeskId] = useState(null); 
  const prevDeskStatus = useRef(null);
  const lastReportNotifiedRef = useRef(null);
  const adminMessageSeenRef = useRef(new Set());
  const adminGuestReportNotifiedRef = useRef(new Set());
  const closingNotificationSeenRef = useRef(new Set());
  // FCM telefon push kaydının aynı kullanıcı/cihaz için tekrar tekrar oluşturulmasını engeller.
  const pushRegistrationRef = useRef({ userId: null, token: null, working: false });
  const [showRules, setShowRules] = useState(false);

  // Push bildirim sistemini yönetici panelinden kontrol etmek için tanılama durumu.
  const [pushDiagnostics, setPushDiagnostics] = useState({
    loading: false,
    checked: false,
    notificationSupported: false,
    notificationPermission: 'unknown',
    serviceWorkerSupported: false,
    serviceWorkerActive: false,
    messagingSupported: false,
    vapidConfigured: false,
    apiReachable: false,
    apiStatus: null,
    apiMessage: '',
    lastCheckedAt: null,
    manualWorkerResult: '',
    manualWorkerError: ''
  });
  const [pushTestSendingUserId, setPushTestSendingUserId] = useState(null);
  const [manualWorkerBusy, setManualWorkerBusy] = useState(false);

  const refreshPushDiagnostics = async () => {
    setPushDiagnostics(prev => ({ ...prev, loading: true }));

    const notificationSupported = typeof window !== 'undefined' && 'Notification' in window;
    const notificationPermission = notificationSupported ? Notification.permission : 'unsupported';
    const serviceWorkerSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
    const vapidConfigured = !!String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();

    let serviceWorkerActive = false;
    let messagingSupported = false;
    let apiReachable = false;
    let apiStatus = null;
    let apiMessage = '';

    try {
      messagingSupported = await isMessagingSupported().catch(() => false);
    } catch (e) {
      messagingSupported = false;
    }

    if (serviceWorkerSupported) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        serviceWorkerActive = registrations.some(reg => {
          const url =
            reg.active?.scriptURL ||
            reg.waiting?.scriptURL ||
            reg.installing?.scriptURL ||
            '';
          return url.includes('firebase-messaging-sw.js');
        });
      } catch (e) {
        serviceWorkerActive = false;
      }
    }

    try {
      const response=await fetch('/api/send-push', {
        method: 'GET',
        cache: 'no-store'
      });

      apiStatus = response.status;
      let payload = null;
      try {
        payload = await response.json();
      } catch (e) {}

      // Endpoint GET için 405 döndürüyorsa bu API'nin düzgün ayağa kalktığı anlamına gelir.
      apiReachable = response.status === 405 || response.ok;
      apiMessage = payload?.message || (apiReachable ? 'API erişilebilir.' : `HTTP ${response.status}`);
    } catch (error) {
      apiReachable = false;
      apiMessage = error?.message || 'API bağlantısı kurulamadı.';
    }

    setPushDiagnostics({
      loading: false,
      checked: true,
      notificationSupported,
      notificationPermission,
      serviceWorkerSupported,
      serviceWorkerActive,
      messagingSupported,
      vapidConfigured,
      apiReachable,
      apiStatus,
      apiMessage,
      lastCheckedAt: Date.now()
    });
  };

  const sendAdminTestPush = async (user) => {
    if (!user?.id) return;

    const tokenCount = Array.isArray(user.pushTokens)
      ? user.pushTokens.filter(Boolean).length
      : 0;

    if (tokenCount === 0) {
      showMessage(
        'FCM Token Bulunamadı',
        `${user.name || 'Bu kullanıcı'} için kayıtlı telefon push tokenı bulunmuyor. Kullanıcının telefondan Vercel adresini açıp bildirim izni vermesi ve öğrenci hesabına giriş yapması gerekir.`,
        'warning'
      );
      return;
    }

    setPushTestSendingUserId(user.id);

    try {
      const result = await sendServerPush({
        userId: user.id,
        title: '🔔 SGM Push Testi',
        body: 'Bu bildirimi görüyorsanız telefon push bildirim sistemi başarıyla çalışıyor.',
        type: 'ADMIN_PUSH_TEST',
        deskId: user.activeDeskId || null,
        logId: `test-${Date.now()}-${user.id}`
      });

      if (result?.success && !result?.skipped) {
        showMessage(
          'Test Bildirimi Gönderildi',
          `${user.name || 'Kullanıcı'} için push isteği Vercel API üzerinden gönderildi. Telefon bildirimlerini kontrol edin.`,
          'success'
        );
      } else if (result?.reason === 'localhost') {
        showMessage(
          'Vercel Üzerinden Test Edin',
          'Gerçek telefon push testi localhost yerine Vercel adresinde yapılmalıdır.',
          'warning'
        );
      } else {
        showMessage(
          'Push Gönderilemedi',
          result?.reason === 'no-token'
            ? 'Kullanıcının kayıtlı FCM tokenı bulunamadı.'
            : `Push gönderimi tamamlanamadı.${result?.error ? ` Hata: ${result.error}` : ''}`,
          'danger'
        );
      }
    } catch (error) {
      showMessage(
        'Push Test Hatası',
        error?.message || 'Test bildirimi gönderilemedi.',
        'danger'
      );
    } finally {
      setPushTestSendingUserId(null);
    }
  };

  const forceRegisterMessagingWorker = async () => {
    setManualWorkerBusy(true);

    try {
      if (!('serviceWorker' in navigator)) {
        throw new Error('Bu tarayıcı Service Worker desteklemiyor.');
      }

      if (!app) {
        throw new Error('Firebase uygulaması başlatılmamış.');
      }

      const cfg = app.options || {};
      const swParams = new URLSearchParams({
        apiKey: cfg.apiKey || '',
        authDomain: cfg.authDomain || '',
        projectId: cfg.projectId || '',
        storageBucket: cfg.storageBucket || '',
        messagingSenderId: cfg.messagingSenderId || '',
        appId: cfg.appId || ''
      });

      // Önceden bozuk/yanlış FCM worker kaydı varsa temizle.
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        const scriptUrl =
          reg.active?.scriptURL ||
          reg.waiting?.scriptURL ||
          reg.installing?.scriptURL ||
          '';

        if (scriptUrl.includes('firebase-messaging-sw.js')) {
          try {
            await reg.unregister();
          } catch (e) {}
        }
      }

      const swUrl = `/firebase-messaging-sw.js?${swParams.toString()}&force=${Date.now()}`;

      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: '/',
        updateViaCache: 'none'
      });

      try {
        await registration.update();
      } catch (e) {}

      const readyRegistration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Service Worker aktif hale gelmedi (15 sn zaman aşımı).')),
            15000
          )
        )
      ]);

      const finalReg = readyRegistration || registration;
      const finalUrl =
        finalReg.active?.scriptURL ||
        finalReg.waiting?.scriptURL ||
        finalReg.installing?.scriptURL ||
        '';

      setPushDiagnostics(prev => ({
        ...prev,
        checked: true,
        serviceWorkerSupported: true,
        serviceWorkerActive: true,
        manualWorkerResult: `Service Worker aktif. Scope: ${finalReg.scope || '/'} | URL: ${finalUrl || 'bulunamadı'}`,
        manualWorkerError: ''
      }));

      if (currentUser?.id) {
        updateUserPushDebug(currentUser.id, {
          pushLastStage: 'manuel_worker_aktif',
          pushLastError: '',
          pushLastErrorCode: '',
          pushLastAttemptAt: Date.now(),
          pushServiceWorkerScope: finalReg.scope || '',
          pushServiceWorkerUrl: finalUrl
        });
      }

      showMessage(
        'Service Worker Aktif',
        'Firebase Messaging Service Worker başarıyla kaydedildi. Şimdi telefon bildirim kaydını yeniden deneyebilirsiniz.',
        'success'
      );

      return finalReg;

    } catch (error) {
      setPushDiagnostics(prev => ({
        ...prev,
        checked: true,
        serviceWorkerActive: false,
        manualWorkerResult: '',
        manualWorkerError: error?.message || String(error)
      }));

      if (currentUser?.id) {
        updateUserPushDebug(currentUser.id, {
          pushLastStage: 'manuel_worker_hatasi',
          pushLastError: error?.message || String(error),
          pushLastErrorCode: error?.name || '',
          pushLastAttemptAt: Date.now()
        });
      }

      showMessage(
        'Service Worker Hatası',
        error?.message || 'Service Worker kaydedilemedi.',
        'danger'
      );

      return null;
    } finally {
      setManualWorkerBusy(false);
    }
  };

  const checkLibraryOpen = () => {
      if (!settings.openTime || !settings.closeTime) return true;
      const d = new Date();
      const currentTimeMin = d.getHours() * 60 + d.getMinutes();
      const [openH, openM] = settings.openTime.split(':').map(Number);
      const openTimeMin = openH * 60 + openM;
      const [closeH, closeM] = settings.closeTime.split(':').map(Number);
      const closeTimeMin = closeH * 60 + closeM;

      if (openTimeMin < closeTimeMin) {
          return currentTimeMin >= openTimeMin && currentTimeMin < closeTimeMin;
      } else {
          return currentTimeMin >= openTimeMin || currentTimeMin < closeTimeMin;
      }
  };

  useEffect(() => {
    if (!currentUser) return;
    const safeUsers = Array.isArray(users) ? users : [];
    const myUser = safeUsers.find(u => u.id === currentUser.id);
    const safeDesks = Array.isArray(desks) ? desks : [];
    const currentMyDesk = myUser && myUser.activeDeskId ? safeDesks.find(d => d.id === myUser.activeDeskId) : null;

    if (currentMyDesk) {
      // reportEndTime her ihbar için yeni olduğundan aynı ihbarı sadece bir kez bildirir.
      const currentUserRecord = safeUsers.find(u => u.id === currentUser.id);
      const isGuestSession = currentUserRecord?.activeDeskRole === 'guest' || currentMyDesk.guestOccupant === currentUser.id;
      const isReportedForMe = isGuestSession ? currentMyDesk.guestReported === true : currentMyDesk.status === 'reported';
      const reportEndForMe = isGuestSession ? currentMyDesk.guestReportEndTime : currentMyDesk.reportEndTime;
      const reportKey = isReportedForMe ? `${currentMyDesk.id}-${currentUser.id}-${reportEndForMe || 0}` : null;

      if (isReportedForMe && reportKey && lastReportNotifiedRef.current !== reportKey) {
        lastReportNotifiedRef.current = reportKey;

        const safeReportWaitMinutes = Number.isFinite(Number(settings.reportWaitTime)) && Number(settings.reportWaitTime) > 0
          ? Number(settings.reportWaitTime)
          : 5;
        const notificationText = `Masa ${currentMyDesk.id} numaralı ${isGuestSession ? 'misafir' : 'ana'} oturumunuz masada bulunmadığınız gerekçesiyle bildirildi. ${safeReportWaitMinutes} dakika içinde masaya dönüp QR kod ile doğrulama yapın.`;

        // Tarayıcı / işletim sistemi bildirimi
        sendNotification("Dikkat: Masanız İhbar Edildi!", notificationText);

        // Bildirim izni kapalı olsa bile kullanıcının uygulama ekranında uyarı görünür.
        showMessage(
          "Masanız İhbar Edildi!",
          <div className="space-y-3">
            <p className="text-sm text-slate-700">{notificationText}</p>
            <p className="text-xs font-bold text-red-600">Süre dolmadan “Masadayım, Doğrula!” butonundan QR kodunuzu okutun.</p>
          </div>,
          "danger"
        );
      } else if (prevDeskStatus.current === 'on_break' && currentMyDesk.status === 'occupied') {
        sendNotification("Mola Süreniz Doldu!", "Mola süreniz bittiği için masa tekrar aktif duruma geçti. Kurallara uymak için lütfen masanıza dönün.");
      }

      prevDeskStatus.current = currentMyDesk.status;
    } else {
      prevDeskStatus.current = null;
      lastReportNotifiedRef.current = null;
    }
  }, [desks, users, currentUser, settings.reportWaitTime]);

  useEffect(() => {
    if (!db || !fbUser || !currentUser?.id) { setStudentMessages([]); return; }
    let retryTimer;
    const unsubscribe = onSnapshot(getLiveDoc('sgmMessages', currentUser.id), snap => {
      if (snap.exists()) setStudentMessages([snap.data()]);
    }, error => {
      handleFirestoreQuotaError(error);
      retryTimer = setTimeout(() => setSyncRetryEpoch(value => value + 1), Math.max(3000, quotaBackoffUntilRef.current - Date.now()));
    });
    return () => { unsubscribe(); clearTimeout(retryTimer); };
  }, [fbUser, currentUser?.id, syncRetryEpoch]);

  useEffect(() => {
    if (!app || !currentUser?.id) return;
    let unsubscribe, cancelled = false;
    isMessagingSupported().then(supported => {
      if (!supported || cancelled) return;
      unsubscribe = onMessage(getMessaging(app), payload => {
        const data = payload.data || {};
        if (data.userId && data.userId !== currentUser.id) return;
        const title = payload.notification?.title || data.title || 'Sarıçam GM';
        const body = payload.notification?.body || data.body || 'Yeni bildiriminiz var.';
        if (data.type === 'ADMIN_MASA_MESAJI') {
          setStudentMessages([{ id: data.logId, type: data.type, userId: currentUser.id,
            deskId: Number(data.deskId), time: Date.now(), message: body, notificationTitle: title, notificationBody: body }]);
        } else if (String(data.type || '').includes('İHBAR')) {
          sendNotification(title, body);
          // The live desk listener owns the countdown/modal; receiving a push never logs a new event.
        }
      });
    }).catch(() => {});
    return () => { cancelled = true; unsubscribe?.(); };
  }, [currentUser?.id]);

  // Yönetici tarafından masa sahibine gönderilen kısa mesajları bu kullanıcının cihazında gösterir.
  // Mesajlar Firestore/log senkronizasyonu üzerinden gelir; aynı mesaj aynı cihazda ikinci kez gösterilmez.
  useEffect(() => {
    if (!currentUser || !Array.isArray(logs)) return;

    const storageKey = `sgm_seen_admin_messages_${currentUser.id}`;
    let seenIds = new Set();
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(stored)) seenIds = new Set(stored);
    } catch (e) {}

    // Ref ile localStorage listesini birleştir.
    adminMessageSeenRef.current.forEach(id => seenIds.add(id));

    const pendingMessages = [...new Map([...logs, ...studentMessages].map(log => [log.id, log])).values()]
      .filter(log =>
        log &&
        log.type === 'ADMIN_MASA_MESAJI' &&
        log.userId === currentUser.id &&
        Number(log.deskId) === Number(currentUser.activeDeskId) &&
        !seenIds.has(log.id)
      )
      .sort((a, b) => Number(a.time || 0) - Number(b.time || 0));

    if (pendingMessages.length === 0) return;

    // Birden fazla bekleyen mesaj varsa en yenisini ekranda göster; tümünü görüldü olarak işaretle.
    pendingMessages.forEach(log => {
      seenIds.add(log.id);
      adminMessageSeenRef.current.add(log.id);
    });

    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(seenIds).slice(-100)));
    } catch (e) {}

    const latest = pendingMessages[pendingMessages.length - 1];
    const title = latest.notificationTitle || 'Yönetici Masa Kontrol Mesajı';
    const body = latest.notificationBody || latest.message || 'Yönetici masanızla ilgili bir bilgilendirme gönderdi.';

    sendNotification(title, body);
    showMessage(
      title,
      <div className="space-y-3">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
          <p className="text-sm text-slate-700">{body}</p>
        </div>
        {latest.deskId && <p className="text-xs text-slate-500">Masa: <b>{latest.deskId}</b></p>}
        <p className="text-xs font-semibold text-blue-700">Bu mesaj yönetici tarafından masa kontrolü sırasında gönderildi.</p>
      </div>,
      latest.notificationLevel === 'danger' ? 'danger' : latest.notificationLevel === 'warning' ? 'warning' : 'info'
    );
  }, [logs, studentMessages, currentUser]);

  // Yönetici paneli açıkken yeni misafir ihbarı geldiğinde anlık uyarı göster.
  useEffect(() => {
    if (view !== 'admin_dash') return;
    const safeDesks = Array.isArray(desks) ? desks : [];
    const safeUsers = Array.isArray(users) ? users : [];

    safeDesks.forEach(desk => {
      if (!desk.guestOccupant || !desk.guestReported || !desk.guestReportEndTime) return;
      const key = `${desk.id}-${desk.guestOccupant}-${desk.guestReportEndTime}`;
      if (adminGuestReportNotifiedRef.current.has(key)) return;
      adminGuestReportNotifiedRef.current.add(key);

      const guest = safeUsers.find(u => u.id === desk.guestOccupant);
      const guestName = guest?.name || 'Misafir kullanıcı';
      sendNotification('Misafir Kullanıcı İhbar Edildi', `Masa ${desk.id} - ${guestName} masada bulunmadığı gerekçesiyle ihbar edildi.`);
      showMessage(
        'Misafir Kullanıcı İhbar Edildi',
        <div className="space-y-3">
          <p className="text-sm text-slate-700"><strong>Masa {desk.id}</strong> üzerindeki <strong>{guestName}</strong> adlı misafir kullanıcı masada bulunmadığı gerekçesiyle ihbar edildi.</p>
          <p className="text-xs text-slate-500">Masa Kontrolü bölümünden ana kullanıcı ve misafir kaydını birlikte kontrol edebilirsiniz.</p>
          <button onClick={() => { closeMessage(); setLiveDeskId(desk.id); setAdminTab('desks'); setTimeout(() => setModal({ isOpen: true, type: 'info', title: `Masa ${desk.id} Yönetimi`, content: null }), 100); }} className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold">Masa Kontrolünü Aç</button>
        </div>,
        'warning'
      );
    });
  }, [desks, users, view]);

  useEffect(() => {
    if (!db && settings.reportsEnabled === false) {
       const next = {...settingsRef.current, reportsEnabled: true};
       settingsRef.current = next; setSettings(next);
    }
  }, [settings.reportsEnabled]);

  // Aylık günlük kod takvimi:
  // - İçinde bulunulan ayın tüm günleri için 6 haneli kodlar hazırlanır.
  // - Gün geldiğinde aylık listedeki kod otomatik olarak aktif günlük koda dönüşür.
  // - Yarının kodu da aynı aylık listeden alınır; eski daily/next alanları geriye dönük uyumluluk için korunur.
  // - Yönetici bugünün veya yarının kodunu değiştirirse aylık listedeki karşılığı da aynı anda güncellenir.
















  const loadScriptOnce = (src, id) => new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (window.html2pdf) return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = id; script.src = src; script.async = true;
    script.onload = resolve; script.onerror = reject;
    document.body.appendChild(script);
  });



  const requestScreenWakeLock = async () => {
    wakeLockWantedRef.current = true;
    if (!navigator.wakeLock || document.visibilityState !== 'visible') { setWakeLockStatus('unsupported'); return; }
    if (wakeLockRef.current && !wakeLockRef.current.released) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockRef.current = sentinel; setWakeLockStatus('active');
      sentinel.addEventListener('release', () => { wakeLockRef.current = null; setWakeLockStatus('released'); });
      addLog('EKRAN_ACIK_TUTMA', 'Ekranı açık tutma isteği kabul edildi.');
    } catch { setWakeLockStatus('denied'); addLog('EKRAN_ACIK_TUTMA_RED', 'Ekranı açık tutma isteği cihaz tarafından kabul edilmedi.'); }
  };
  useEffect(() => {
    const resume = () => { if (document.visibilityState === 'visible' && wakeLockWantedRef.current) requestScreenWakeLock(); };
    document.addEventListener('visibilitychange', resume);
    return () => { document.removeEventListener('visibilitychange', resume); wakeLockRef.current?.release().catch(() => {}); };
  }, []);

  const requestAllPermissions = async () => {
    setPermissionsState('requesting');
    let locStr = "Konum Alınamadı";
    const withTimeout = (promise, timeoutMs) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('İstek zaman aşımına uğradı')), timeoutMs))
    ]);

    try {
      if (navigator.geolocation) {
        const pos = await withTimeout(new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 6000,
            maximumAge: 0
          });
        }), 7000);

        locStr = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      }
    } catch (err) {
      try {
        const res = await withTimeout(fetch('https://get.geojs.io/v1/ip/geo.json'), 4000);
        const data = await res.json();
        if (data && data.city) {
          locStr = `${data.city}, ${data.region} (IP)`;
        }
      } catch (ipErr) {
        try {
          const res2 = await withTimeout(fetch('https://ipwho.is/'), 4000);
          const data2 = await res2.json();
          if (data2 && data2.city) {
            locStr = `${data2.city}, ${data2.region} (IP)`;
          }
        } catch (e) {}
      }
    }

    try {
      setUserLocation(locStr);
      localStorage.setItem('sgm_last_location', locStr);
    } catch (e) {}

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ video: true }), 7000);
        stream.getTracks().forEach(t => t.stop());
      }
    } catch (e) {}

    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (e) {}
    }

    addLog('SISTEM_GIRIS', 'Uygulamaya cihaz üzerinden giriş yapıldı.', null, null, false, locStr);
    setPermissionsState('granted');
    setBatteryGuidanceOpen(true);
    addLog('PIL_AYARI_BILGILENDIRME', 'Pil optimizasyonu / Kısıtlanmamış ayarı için kullanıcıya yönlendirme gösterildi.');
  };

  useEffect(() => {
    if (!auth) {
      setIsDataLoaded(true);
      return;
    }
    let disposed = false, retryTimer = null, retryAttempt = 0, signingIn = false, authStateEpoch = 0;
    const initAuth = async () => {
      if (disposed || signingIn) return;
      signingIn = true;
      try {
        await ensureTabAuthPersistence(); await auth.authStateReady();
        if (auth.currentUser || disposed) return;
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInTabWithCustomToken(__initial_auth_token);
        } else {
          await signInTabAnonymously();
        }
        retryAttempt = 0;
      } catch (error) {
        if (!disposed) {
          setIsDataLoaded(true);
          retryTimer = setTimeout(initAuth, Math.min(60000, 3000 * 2 ** retryAttempt++));
        }
      } finally { signingIn = false; }
    };
    const resumeAuth = () => { clearTimeout(retryTimer); initAuth(); };
    window.addEventListener('online', resumeAuth);
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, user => {
      const epoch = ++authStateEpoch;
      setFbUser(user);
      if (!user) {
        verifiedAdminUidRef.current = null;
        setAdminAuthorized(false);
        usersRef.current = [];
        setUsers([]);
        localStorage.removeItem('sgm_users');
      } else user.getIdTokenResult().then(result => {
        // Önceki anonim/öğrenci oturumunun gecikmiş sonucu yeni yönetici oturumunu ezmesin.
        if (disposed || epoch !== authStateEpoch || auth.currentUser?.uid !== user.uid) return;
        const isAdmin = result.claims.admin === true;
        verifiedAdminUidRef.current = isAdmin ? user.uid : null;
        setAdminAuthorized(isAdmin);
        if (!isAdmin) {
          // Eski yönetici görünümü öğrenci/anonim oturumla açık tutulmaz.
          setView(previous => previous === 'admin_dash' ? 'admin_login' : previous);
          const ownUser = usersRef.current.find(row => String(row.id) === user.uid);
          usersRef.current = ownUser ? [ownUser] : [];
          setUsers(usersRef.current);
          localStorage.setItem('sgm_users', JSON.stringify(usersRef.current));
        }
      }).catch(() => {
        if (disposed || epoch !== authStateEpoch || auth.currentUser?.uid !== user.uid) return;
        verifiedAdminUidRef.current = null;
        setAdminAuthorized(false);
        usersRef.current = [];
        setUsers([]);
        localStorage.removeItem('sgm_users');
      });
    });
    return () => { disposed = true; clearTimeout(retryTimer); window.removeEventListener('online', resumeAuth); unsubscribe(); };
  }, []);

  // ============================================================
  // FIRESTORE KOTA DOSTU PARÇALI SENKRONİZASYON
  // ============================================================
  // Eski sürüm bütün uygulama state'ini tek bir `allData` belgesine yazıyordu.
  // Bu yapı küçük bir masa/log değişikliğinde bile kullanıcılar + masalar + loglar +
  // ihlaller + geri bildirimler + krokiyi tekrar yazdığı için Firestore kotasını hızla
  // tüketebiliyordu. Yeni yapıda yalnızca değişen kayıt kendi belgesine yazılır.
  // `allData` sadece eski kurulumdan ilk geçişte bir kez okunur.
  const getLiveCollection = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);
  const getLiveDoc = (name, id) => doc(db, 'artifacts', appId, 'public', 'data', name, String(id));
  const getLiveSettingsDoc = () => getLiveDoc('sgmConfig', 'settings');
  const getLiveLayoutDoc = () => getLiveDoc('sgmConfig', 'layout');
  const getLiveMetaDoc = () => getLiveDoc('sgmConfig', 'meta');
  const cloudActions = createCloudActions({ db, runTransaction, ref: getLiveDoc,
    settings: () => settingsRef.current, dayKey: getLocalDayKey, isRestricted, lostDeskToday, applyViolationPolicy });
  const runStudentDeskAction = async (action, input = {}) => {
    if (!fbUser) throw new Error('Öğrenci oturumu bulunamadı.');
    const idToken = await fbUser.getIdToken();
    const response = await fetch('/api/student-desk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ action, ...input })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.message || `Masa servisi HTTP ${response.status} döndürdü.`);
    }
    if (payload.result === null) return null;
    return payload;
  };
  const runStudentActivity = async (action, input = {}) => {
    if (!fbUser) throw new Error('Öğrenci oturumu bulunamadı.');
    const idToken = await fbUser.getIdToken();
    const response = await fetch('/api/student-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ action, ...input })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.message || `Öğrenci servisi HTTP ${response.status} döndürdü.`);
    }
    return payload.result;
  };
  const applyCloudRows = ({ desk, user, desks: updatedDesks }) => {
    if (desk) updatedDesks = [desk];
    if (updatedDesks?.length) {
      const updates = rowsToMap(updatedDesks);
      const next = desksRef.current.map(row => updates.get(String(row.id)) || row);
      updatedDesks.forEach(row => granularBaselineRef.current.desks.set(String(row.id), row));
      desksRef.current = next; setDesks(next);
    }
    if (user) {
      const normalized = normalizeRemoteUsers([user])[0];
      granularBaselineRef.current.users.set(String(user.id), normalized);
      usersRef.current = usersRef.current.map(row => row.id === user.id ? normalized : row);
      setUsers(usersRef.current);
      setCurrentUser(previous => previous?.id === user.id ? { ...previous, ...normalized } : previous);
    }
  };


  const granularSyncReadyRef = useRef(false);
  const granularLoadedRef = useRef({
    settings: false, layout: false, desks: false, users: false,
    logs: false, violations: false, feedback: false
  });
  const granularBaselineRef = useRef({
    settings: null,
    layout: null,
    desks: new Map(),
    users: new Map(),
    logs: new Map(),
    violations: new Map(),
    feedback: new Map()
  });
  const granularSeenRemoteRef = useRef({
    settings: false, layout: false, desks: false, users: false,
    logs: false, violations: false, feedback: false
  });
  const granularWriteTimerRef = useRef(null);
  const adminUserSaveInFlightRef = useRef(false);
  const [adminUserSavingId, setAdminUserSavingId] = useState(null);
  const granularWriteChainRef = useRef(Promise.resolve());
  const quotaBackoffUntilRef = useRef(0);
  const deskQrRepairInFlightRef = useRef(false);
  const deskQrAutoRecoveryAttemptedRef = useRef(false);
  const [deskQrRepairBusy, setDeskQrRepairBusy] = useState(false);
  const [usersSyncError, setUsersSyncError] = useState('');

  const stableJson = value => {
    try { return JSON.stringify(value); } catch { return ''; }
  };

  const rowsToMap = rows => new Map(
    (Array.isArray(rows) ? rows : [])
      .filter(row => row && row.id !== undefined && row.id !== null)
      .map(row => [String(row.id), row])
  );

  const normalizeRemoteDesks = rows => (Array.isArray(rows) ? rows : INITIAL_DESKS)
    .filter(d => d && Number.isInteger(Number(d.id)) && Number(d.id) > 0 && Number(d.id) <= 35)
    .map(d => ({
      ...d,
      id: Number(d.id),
      guestOccupant: d.guestOccupant || null,
      guestSessionStartTime: d.guestSessionStartTime || null,
      guestBreakEndTime: d.guestBreakEndTime || null,
      guestReported: d.guestReported === true,
      guestReportEndTime: d.guestReportEndTime || null,
      guestReportIssuedAt: d.guestReportIssuedAt || null,
      guestReportVerifiedAt: d.guestReportVerifiedAt || null,
      pendingOccupant: d.pendingOccupant || null,
      pendingDeskRole: d.pendingDeskRole || null,
      pendingDeskDeadline: d.pendingDeskDeadline || null,
      reportIssuedAt: d.reportIssuedAt || null,
      reportVerifiedAt: d.reportVerifiedAt || null
    }));

  const normalizeRemoteUsers = (rows, sourceSettings = settingsRef.current) =>
    normalizeIdentityUsers(Array.isArray(rows) ? rows : []).map(u => ({
      ...u,
      identityNo: /^\d{8}$/.test(u.identityNo || '') ? u.identityNo : legacyIdentity(u.id),
      strikes: Number.isFinite(Number(u.strikes)) ? Number(u.strikes) : 0,
      breaks: {
        short: Number.isFinite(Number(u.breaks?.short)) ? Number(u.breaks.short) : (sourceSettings?.shortBreakCount ?? DEFAULT_SETTINGS.shortBreakCount),
        long: Number.isFinite(Number(u.breaks?.long)) ? Number(u.breaks.long) : (sourceSettings?.longBreakCount ?? DEFAULT_SETTINGS.longBreakCount)
      },
      breaksResetDate: u.breaksResetDate || getLocalDayKey(),
      violationsResetDate: u.violationsResetDate || getLocalDayKey(),
      dailyAccessVerifiedDate: u.dailyAccessVerifiedDate || '',
      canReport: u.canReport !== false,
      blocked: u.blocked === true,
      activeDeskRole: u.activeDeskId ? (u.activeDeskRole || 'owner') : null
    }));

  const mergeRemoteWithPendingLocal = (bucket, remoteRows, localRows) => {
    const raw = Array.isArray(remoteRows) ? remoteRows : [];
    const previous = granularBaselineRef.current[bucket] || new Map();
    if (bucket === 'users') {
      // Tam yönetici snapshot'ında bulunmayan eski yerel kullanıcıyı geri ekleme.
      const knownIds = new Set([...previous.keys(), ...(localRows || []).map(u => String(u.id))]);
      for (const id of knownIds) {
        if (!raw.some(row => String(row.id) === id) && !pendingUserCreatesRef.current.has(id)) {
          serverDeletedUserIdsRef.current.add(id);
        }
      }
      raw.forEach(row => serverDeletedUserIdsRef.current.delete(String(row.id)));
    }
    const merged = granularSeenRemoteRef.current[bucket]
      ? mergePendingRows(raw, localRows, previous, {
          deleted: id => isRecordDeleted(bucket, id) || bucket === 'users' && serverDeletedUserIdsRef.current.has(String(id)),
          creates: bucket === 'users' ? pendingUserCreatesRef.current : new Set()
        })
      : raw.filter(row => !isRecordDeleted(bucket, row.id));
    granularBaselineRef.current[bucket] = rowsToMap(raw);
    granularSeenRemoteRef.current[bucket] = true;
    return merged;
  };

  const markGranularLoaded = key => {
    granularLoadedRef.current[key] = true;
    if (Object.values(granularLoadedRef.current).every(Boolean)) {
      granularSyncReadyRef.current = true;
      setIsDataLoaded(true);
      setTimeout(() => { isInitializingRef.current = false; }, 250);
    }
  };

  const handleFirestoreQuotaError = error => {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (code.includes('resource-exhausted') || /quota|resource.?exhausted/i.test(message)) {
      // Kota doluyken her state değişiminde tekrar tekrar istek atıp durumu daha da
      // ağırlaştırmamak için 5 dakikalık yerel geri çekilme uygulanır.
      quotaBackoffUntilRef.current = Date.now() + (5 * 60 * 1000);
      console.warn('Firestore kotası dolu. Senkronizasyon 5 dakika bekletildi; yerel kayıt çalışmaya devam ediyor.', error);
    } else {
      console.error('Firestore senkronizasyon hatası:', error);
    }
  };

  const persistRowsNow = async (bucketName, rows, baselineKey) => {
    const nextMap = rowsToMap(rows);
    const previousMap = granularBaselineRef.current[baselineKey] || new Map();
    const work = Array.from(nextMap.entries()).filter(([id, row]) =>
      !isRecordDeleted(baselineKey, id) && (!previousMap.has(id) || stableJson(previousMap.get(id)) !== stableJson(row))
    );
    const results = await mapLimited(work, async ([id, row]) => {
      const previous = previousMap.get(id) || {};
      const result = await runTransaction(db, async tx => {
        const target = getLiveDoc(bucketName, id);
        const reads = [tx.get(target)];
        if (baselineKey === 'users') reads.push(tx.get(getLiveDoc('sgmDeletedUsers', id)));
        const [snap, tombstone] = await Promise.all(reads);
        if (tombstone?.exists()) return null;
        if (!snap.exists()) {
          if (baselineKey === 'users' && !pendingUserCreatesRef.current.has(id)) return null;
          // Existing desks/config must never be recreated from an old snapshot.
          if (baselineKey === 'desks' && Object.keys(previous).length) return null;
          tx.set(target, row);
          return row;
        }
        const remote = baselineKey === 'users' ? normalizeRemoteUsers([snap.data()])[0] : normalizeRemoteDesks([snap.data()])[0] || snap.data();
        const fields = baselineKey === 'desks' ? ['status','occupant','ownerDeviceId','pendingOccupant','pendingDeskDeadline','pendingDeskRole','breakEndTime','reportEndTime','reportIssuedAt','reportVerifiedAt','sessionStartTime'] : ['activeDeskId','activeDeskRole','pendingDeskId','pendingDeskDeadline'];
        const patch = atomicFieldPatch(remote, previous, row, fields);
        if (Object.keys(patch).length) tx.set(target, patch, { merge: true });
        return { ...remote, ...patch };
      });
      if (result) {
        granularBaselineRef.current[baselineKey].set(id, result);
        pendingUserCreatesRef.current.delete(id);
      } else if (baselineKey === 'users') {
        serverDeletedUserIdsRef.current.add(id);
        usersRef.current = (usersRef.current || []).filter(user => String(user.id) !== id);
        setUsers(usersRef.current);
      }
    });
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    // Deletion is an explicit operation, never inferred from a partial query/window.
  };

  const persistGranularStateNow = async snapshot => {
    if (!db || deskQrRepairInFlightRef.current) return;
    if (!fbUser || Date.now() < Number(quotaBackoffUntilRef.current || 0)) throw new Error('Sunucu bağlantısı veya kota bekleniyor. İşlem henüz sunucuya kaydedilmedi.');
    if (!adminAuthorized) return;

    const jobs = [];
    if (snapshot.settings && adminAuthorized) {
      const settingsJson = stableJson(snapshot.settings);
      if (granularBaselineRef.current.settings !== settingsJson) {
        const previous = JSON.parse(granularBaselineRef.current.settings || '{}');
        jobs.push(runTransaction(db, async tx => {
          const ref = getLiveSettingsDoc(), snap = await tx.get(ref);
          if (!snap.exists()) { tx.set(ref, snapshot.settings); return snapshot.settings; }
          const remote = { ...DEFAULT_SETTINGS, ...snap.data() }, patch = nonConflictingPatch(remote, previous, snapshot.settings);
          if (Object.keys(patch).length) tx.set(ref, patch, { merge: true });
          return { ...remote, ...patch };
        }).then(result => { granularBaselineRef.current.settings = stableJson(result); }));
      }
    }
    if (snapshot.layoutElements && adminAuthorized) {
      const layoutJson = stableJson(snapshot.layoutElements);
      if (granularBaselineRef.current.layout !== layoutJson) {
        jobs.push(setDoc(getLiveLayoutDoc(), { elements: snapshot.layoutElements }).then(() => {
          granularBaselineRef.current.layout = layoutJson;
        }));
      }
    }

    if (snapshot.desks) jobs.push(persistRowsNow('sgmDesks', snapshot.desks, 'desks'));
    if (snapshot.users) jobs.push(persistRowsNow('sgmUsers', snapshot.users, 'users'));

    try {
      await Promise.all(jobs);
    } catch (error) {
      handleFirestoreQuotaError(error);
      throw error;
    }
  };

  const repairDeskQrData = async (notify = true) => {
    if (deskQrRepairInFlightRef.current) return;
    if (db && (!fbUser || !adminAuthorized)) {
      if (notify) showMessage('Bağlantı Bekleniyor', 'Masa onarımı için yönetici bağlantısını bekleyin.', 'warning');
      return;
    }
    deskQrRepairInFlightRef.current = true;
    setDeskQrRepairBusy(true);
    try {
      let rows = Array.isArray(desksRef.current) ? desksRef.current : [];
      let qrFallbackRows = [...rows];
      if (db && fbUser) {
        if (Date.now() < Number(quotaBackoffUntilRef.current || 0)) throw new Error('Senkronizasyon kotası dolu. Birkaç dakika sonra tekrar deneyin.');
        const live = await getDocs(getLiveCollection('sgmDesks'));
        const remote = live.docs.map(snap => ({ ...snap.data(), id: snap.data()?.id ?? snap.id }));
        rows = remote;
        const valid = remote.filter(d => Number.isInteger(Number(d.id)) && Number(d.id) >= 1 && Number(d.id) <= 35);
        if (new Set(valid.map(d => Number(d.id))).size < 35 || valid.some(d => !d.qrCode)) {
          const legacy = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sgmData', 'allData'));
          const legacyRows = legacy.exists() ? legacy.data()?.desks : null;
          if (Array.isArray(legacyRows)) qrFallbackRows.push(...legacyRows);
        }
      }
      const repaired = completeMainLibraryDesks(rows, qrFallbackRows);
      if (!repaired.length) throw new Error('Ana Salon için geçerli masa kaydı bulunamadı.');
      let finalRows = repaired;
      if (db && fbUser) {
        finalRows = await Promise.all(repaired.map(desk => runTransaction(db, async tx => {
          const ref = getLiveDoc('sgmDesks', desk.id);
          const snap = await tx.get(ref);
          if (snap.exists()) {
            const current = { ...snap.data(), id: Number(desk.id) };
            const completed = normalizeDeskQrRows([{ ...current, qrCode: current.qrCode || desk.qrCode }])[0];
            if (!current.qrCode) tx.set(ref, { qrCode: completed.qrCode }, { merge: true });
            return completed;
          }
          tx.set(ref, desk);
          return desk;
        })));
      }
      finalRows.sort((a, b) => Number(a.id) - Number(b.id));
      if (db && fbUser) granularBaselineRef.current.desks = rowsToMap(finalRows);
      desksRef.current = finalRows;
      setDesks(finalRows);
      localStorage.setItem('sgm_desks', JSON.stringify(finalRows));
      if (notify) showMessage('QR Kodları Hazır', `${finalRows.length} masanın QR kodu kontrol edildi. Mevcut QR kodları korundu, eksik kayıtlar tamamlandı.`, 'success');
    } catch (error) {
      handleFirestoreQuotaError(error);
      if (notify) showMessage('QR Onarımı Tamamlanamadı', error.message || 'Sistem bağlantısını kontrol edip tekrar deneyin.', 'warning');
    } finally {
      deskQrRepairInFlightRef.current = false;
      setDeskQrRepairBusy(false);
    }
  };

  const buildLegacyNormalizedData = data => {
    const incomingSettings = mergeRegistrationSettings(settingsRef.current, { ...DEFAULT_SETTINGS, ...(data?.settings || {}) });
    const normalizedSettings = { ...incomingSettings, showBlueRoomKroki: false, layoutSchemaVersion: 3 };
    const remoteLayoutIsOld = Number(data?.settings?.layoutSchemaVersion || 0) < 3;
    const oldLogs = Array.isArray(data?.logs) ? data.logs : [];
    return {
      settings: normalizedSettings,
      desks: normalizeRemoteDesks(Array.isArray(data?.desks) ? data.desks : INITIAL_DESKS),
      users: normalizeRemoteUsers(Array.isArray(data?.users) ? data.users : [], normalizedSettings)
        .filter(u => u?.id && !isRecordDeleted('users', u.id)),
      logs: oldLogs.filter(x => x?.id && !isRecordDeleted('logs', x.id)).slice(0, 500),
      violationRecords: (Array.isArray(data?.violationRecords)
        ? data.violationRecords
        : oldLogs.filter(log => log && String(log.type || '').startsWith('IHLAL')).map(log => ({
            id: `VIOL-${log.id}`, sourceLogId: log.id, time: log.time, type: log.type,
            message: log.message, deskId: log.deskId || null, userId: log.userId || null,
            userInfo: log.userInfo || 'Sistem / Anonim', deviceInfo: log.deviceInfo || '-', locationInfo: log.locationInfo || '-'
          })))
        .filter(x => x?.id && !isRecordDeleted('violations', x.id)),
      feedbackRecords: (Array.isArray(data?.feedbackRecords) ? data.feedbackRecords : [])
        .filter(x => x?.id && !isRecordDeleted('feedback', x.id)),
      layoutElements: remoteLayoutIsOld
        ? generateDefaultLayout()
        : (Array.isArray(data?.layoutElements) && data.layoutElements.length ? data.layoutElements : generateDefaultLayout())
    };
  };

  const applyGranularInitialData = data => {
    settingsRef.current = data.settings;
    setSettings(data.settings);
    desksRef.current = data.desks;
    usersRef.current = data.users;
    logsRef.current = data.logs;
    violationRecordsRef.current = data.violationRecords;
    feedbackRecordsRef.current = data.feedbackRecords;
    layoutElementsRef.current = data.layoutElements;
    setDesks(data.desks);
    setUsers(data.users);
    setLogs(data.logs);
    setViolationRecords(data.violationRecords);
    setFeedbackRecords(data.feedbackRecords);
    setLayoutElements(data.layoutElements);
  };

  // Hesap düzenleme başarılı mesajı yalnızca sunucu işlemi tamamlanınca gösterilir.
  const saveAdminUserChanges = async (original, desired) => {
    if (adminUserSaveInFlightRef.current) throw new Error('Önce devam eden hesap kaydının tamamlanmasını bekleyin.');
    adminUserSaveInFlightRef.current = true;
    setAdminUserSavingId(original.id);
    clearTimeout(granularWriteTimerRef.current);
    try {
      if (db) {
        if (!auth) throw new Error('Firebase oturumu bulunamadı. Yönetici paneline yeniden giriş yapın.');
        await ensureTabAuthPersistence(); await auth.authStateReady();
        const liveUser = auth.currentUser;
        if (!liveUser) throw new Error('Yönetici oturumu sona ermiş. Yönetici paneline yeniden giriş yapın.');
        let tokenResult;
        try { tokenResult = await liveUser.getIdTokenResult(true); }
        catch (error) { throw new Error('Yönetici oturumu sunucudan doğrulanamadı. Bağlantınızı kontrol edip tekrar deneyin.'); }
        if (auth.currentUser?.uid !== liveUser.uid) throw new Error('Oturum değişti. Yönetici paneline yeniden giriş yapın.');
        if (tokenResult.claims.admin !== true) {
          setAdminAuthorized(false);
          throw new Error('Mevcut Firebase oturumunda yönetici yetkisi yok. Yönetici kullanıcı adı ve şifresiyle yeniden giriş yapın.');
        }
        // React state'i geride kalsa bile gerçek ve doğrulanmış oturum kullanılır.
        verifiedAdminUidRef.current = liveUser.uid;
        setFbUser(liveUser); setAdminAuthorized(true);
      }
      // Önceden sıraya alınmış yazmalar bu açık yönetici işlemini geri alamaz.
      await granularWriteChainRef.current.catch(() => {});
      const patch = Object.fromEntries(Object.entries(desired).filter(([key, value]) => key !== 'id' && stableJson(value) !== stableJson(original[key])));
      // Hesap yetkileri tek bir tutarlı grup olarak yazılır.
      for (const key of ['blocked', 'pendingApproval', 'restrictedUntil', 'restrictionReason', 'canReport']) {
        if (desired[key] !== undefined) patch[key] = desired[key];
      }
      const result = db ? await runTransaction(db, async tx => {
        const userRef = getLiveDoc('sgmUsers', original.id);
        const tombstoneRef = getLiveDoc('sgmDeletedUsers', original.id);
        const [snapshot, tombstone] = await Promise.all([tx.get(userRef), tx.get(tombstoneRef)]);
        if (!snapshot.exists() || tombstone.exists()) throw new Error('Hesap silinmiş; eski kayıt yeniden oluşturulamaz.');
        const remote = snapshot.data();
        tx.set(userRef, patch, {merge: true});
        // Masa, mola ve bildirim alanları sunucudaki güncel hâliyle korunur.
        return {...remote, ...patch, id: original.id};
      }) : desired;
      applyCloudRows({user: result});
      localStorage.setItem('sgm_users', JSON.stringify(usersRef.current));
      return result;
    } finally {
      adminUserSaveInFlightRef.current = false;
      setAdminUserSavingId(null);
    }
  };

  const refreshStudentProfile = async () => {
    const id = currentUser?.id;
    if (!db || !id || auth?.currentUser?.uid !== id) return;
    try {
      const snapshot = await getDocFromServer(getLiveDoc('sgmUsers', id));
      if (auth?.currentUser?.uid !== id) return;
      if (!snapshot.exists()) {
        serverDeletedUserIdsRef.current.add(String(id));
        usersRef.current = []; setUsers([]);
        return;
      }
      const user = {...snapshot.data(), id};
      applyCloudRows({user});
      setUsersSyncError('');
      localStorage.setItem('sgm_users', JSON.stringify(usersRef.current));
    } catch (error) {
      setUsersSyncError('Hesap durumu sunucudan yenilenemedi. Bağlantı ve hesap erişimini kontrol edin.');
      handleFirestoreQuotaError(error);
    }
  };
  useEffect(() => {
    if (!currentUser?.id || !fbUser || fbUser.uid !== currentUser.id) return;
    const refresh = () => { if (!document.hidden) refreshStudentProfile(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [currentUser?.id, fbUser]);

  // Veri kapsamı sayfaya değil doğrulanmış yönetici oturumuna bağlıdır.
  const adminDataMode = adminAuthorized;

  useEffect(() => {
    if (!fbUser || !db) return;
    let cancelled = false;
    let unsubs = [];
    let retryTimer = null;
    const retry = error => {
      handleFirestoreQuotaError(error);
      const delay = /permission-denied|unauthenticated/.test(String(error?.code)) ? 60000 : Math.max(3000, quotaBackoffUntilRef.current - Date.now());
      if (!retryTimer && !cancelled) retryTimer = setTimeout(() => setSyncRetryEpoch(value => value + 1), delay);
    };

    // Yeni öğrenci kayıtları, eski veri aktarımının sonucunu beklemeden dinlenir.
    setUsersSyncError('');
    const userSource = adminDataMode ? getLiveCollection('sgmUsers') : getLiveDoc('sgmUsers', fbUser.uid);
    unsubs.push(onSnapshot(userSource, { includeMetadataChanges: true }, snapshot => {
      if (cancelled || snapshot.metadata.fromCache || auth?.currentUser?.uid !== fbUser.uid) return;
      // Eski tek hesap dinleyicisi, yeni yönetici listesini tek kullanıcıya düşüremez.
      if (!adminDataMode && verifiedAdminUidRef.current === fbUser.uid) return;
      setUsersSyncError('');
      if (adminDataMode) {
        const remoteRows = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
        const normalized = normalizeRemoteUsers(remoteRows, settingsRef.current);
        const merged = mergeRemoteWithPendingLocal('users', normalized, usersRef.current);
        usersRef.current = merged;
        setUsers(merged);
      } else {
        const rows = snapshot.exists()
          ? normalizeRemoteUsers([{ ...snapshot.data(), id: snapshot.id }], settingsRef.current) : [];
        usersRef.current = rows;
        setUsers(rows);
        if (rows[0]) {
          const id = String(rows[0].id);
          serverDeletedUserIdsRef.current.delete(id);
          granularBaselineRef.current.users.set(id, rows[0]);
        } else {
          // Yalnızca önceden bilinen, doğrulanmış hesabın sunucu snapshot'ı
          // silme kanıtıdır. Anonim oturumdaki boş belge yeni kaydı engellemez.
          const id = String(fbUser.uid);
          const savedSession = (() => { try { return JSON.parse(sessionStorage.getItem('sgm_student_session') || 'null'); } catch { return null; } })();
          if (granularBaselineRef.current.users.has(id) || savedSession?.userId === id) {
            serverDeletedUserIdsRef.current.add(id);
            granularBaselineRef.current.users.delete(id);
            sessionStorage.removeItem('sgm_student_session');
            localStorage.removeItem('sgm_users');
            setCurrentUser(previous => previous?.id === id ? null : previous);
            setSelectedDeskId(null); setDeskSelectionDeadline(null);
            setScannerConfig({isOpen: false, mode: null, title: ''});
            setView(previous => previous === 'student_dash' || previous === 'student_feedback' ? 'student_login' : previous);
            const savedRegistration = (() => { try { return JSON.parse(localStorage.getItem('sgm_registration_account') || 'null'); } catch { return null; } })();
            if (savedRegistration?.userId === id) {
              localStorage.removeItem('sgm_registration_account');
              ['sgm_registration_token', 'sgm_registration_credentials', 'sgm_registration_form_url', 'sgm_registration_form_opened'].forEach(key => sessionStorage.removeItem(key));
              setRegistrationPending(''); setRegistrationResult(null); setRegistrationFormUrl(''); setRegistrationFormOpened(false);
            }
          }
        }
        localStorage.setItem('sgm_users', JSON.stringify(rows));
      }
      markGranularLoaded('users');
    }, error => {
      if (cancelled) return;
      setUsersSyncError(/permission-denied/.test(String(error?.code))
        ? 'Kullanıcı listesine erişim reddedildi. Yönetici oturumunu ve Firestore kurallarını kontrol edin.'
        : 'Kullanıcı listesi sunucudan alınamadı. Bağlantı kurulduğunda yeniden denenecek.');
      retry(error);
      setIsDataLoaded(true);
    }));

    const setupGranularSync = async () => {
      try {
        try {
        // Yeni parçalı yapının var olup olmadığını sadece settings belgesiyle kontrol ediyoruz.
        // Yoksa eski allData bir kez okunup yeni koleksiyonlara taşınıyor.
        const liveSettingsSnap = await getDoc(getLiveSettingsDoc());
        if (!liveSettingsSnap.exists() && adminDataMode) {
          const legacyRef = doc(db, 'artifacts', appId, 'public', 'data', 'sgmData', 'allData');
          const legacySnap = await getDoc(legacyRef);
          const legacyData = legacySnap.exists()
            ? buildLegacyNormalizedData(legacySnap.data())
            : {
                settings: { ...settingsRef.current, showBlueRoomKroki: false, useCustomLayout: true, layoutSchemaVersion: 3 },
                desks: normalizeRemoteDesks(desksRef.current),
                users: [],
                logs: logsRef.current || [],
                violationRecords: violationRecordsRef.current || [],
                feedbackRecords: feedbackRecordsRef.current || [],
                layoutElements: layoutElementsRef.current || generateDefaultLayout()
              };

          legacyData.users.forEach(user => pendingUserCreatesRef.current.add(String(user.id)));
          applyGranularInitialData(legacyData);
          await persistGranularStateNow(legacyData);
          await setDoc(getLiveMetaDoc(), { schemaVersion: 2, migratedAt: Date.now() }, { merge: true });
        }

        if (adminDataMode) {
          const meta = await getDoc(getLiveMetaDoc());
          if (meta.data()?.historyMigrationVersion !== 1) {
            const legacySnap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sgmData', 'allData'));
            const legacy = legacySnap.data() || {};
            const oldLogs = Array.isArray(legacy.logs) ? legacy.logs : [];
            const historyItems = [
              ...oldLogs.map(record => ['sgmAudit',record]),
              ...(legacy.violationRecords || []).map(record => ['sgmViolations',record]),
              ...(legacy.feedbackRecords || []).map(record => ['sgmFeedback',record])
            ].filter(([, record]) => record?.id);
            historyItems.forEach(([bucket,record]) => queueAppend(bucket, record));
            await appendChainRef.current;
            if (!historyItems.some(([bucket,record]) => readAppendOutbox()[`${bucket}/${record.id}`])) {
              await setDoc(getLiveMetaDoc(), { historyMigrationVersion: 1 }, { merge: true });
            }
          }
        }
        if (cancelled) return;

        } catch (migrationError) {
          // Eski arşiv/meta izin hatası canlı masa ve kullanıcı dinlemesini durdurmasın.
          retry(migrationError);
        }
        if (cancelled) return;

        // CONFIG: SETTINGS
        unsubs.push(onSnapshot(getLiveSettingsDoc(), snap => {
          if (snap.exists()) {
            const remote = mergeRegistrationSettings(settingsRef.current, { ...DEFAULT_SETTINGS, ...snap.data(), showBlueRoomKroki: false, layoutSchemaVersion: 3 });
            const remoteJson = stableJson(remote);
            granularBaselineRef.current.settings = remoteJson;
            granularSeenRemoteRef.current.settings = true;
            // Tüm cihazlar ve yönetici ekranı sunucunun son ayarını hemen uygular.
            settingsRef.current = remote;
            setSettings(remote);
          }
          markGranularLoaded('settings');
        }, error => { retry(error); setIsDataLoaded(true); }));

        // CONFIG: LAYOUT
        unsubs.push(onSnapshot(getLiveLayoutDoc(), snap => {
          if (snap.exists()) {
            const remoteLayout = Array.isArray(snap.data()?.elements) && snap.data().elements.length
              ? snap.data().elements
              : generateDefaultLayout();
            const remoteJson = stableJson(remoteLayout);
            const localChanged = granularSeenRemoteRef.current.layout &&
              granularBaselineRef.current.layout !== stableJson(layoutElementsRef.current);
            granularBaselineRef.current.layout = remoteJson;
            granularSeenRemoteRef.current.layout = true;
            if (!localChanged) {
              layoutElementsRef.current = remoteLayout;
              setLayoutElements(remoteLayout);
            }
          }
          markGranularLoaded('layout');
        }, error => { retry(error); setIsDataLoaded(true); }));

        const subscribeRows = (firestoreName, key, getLocalRows, applyRows, normalizeRows = rows => rows) => {
          const source = firestoreName === 'sgmAudit' || firestoreName === 'sgmLogs'
            ? query(getLiveCollection(firestoreName), orderBy('time', 'desc'), limit(500))
            : getLiveCollection(firestoreName);
          const unsub = onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
            if (cancelled || snapshot.metadata.fromCache) return;
            let remoteRows = snapshot.docs.map(d => ({ ...d.data(), id: d.data()?.id ?? d.id }));
            remoteRows = normalizeRows(remoteRows);
            // Kısmen oluşmuş koleksiyonda da eksik 35 masa ve QR kayıtları tamamlanır.
            if (key === 'desks') {
              const needsRepair = new Set(remoteRows.map(d => Number(d.id))).size < 35 || remoteRows.some(d => !d.qrCode);
              if (needsRepair && adminDataMode && !deskQrAutoRecoveryAttemptedRef.current) {
                deskQrAutoRecoveryAttemptedRef.current = true;
                repairDeskQrData(false);
              }
              if (remoteRows.length === 0) {
                markGranularLoaded(key);
                return;
              }
            }
            if (key === 'users') remoteRows = normalizeRemoteUsers(remoteRows, settingsRef.current);
            // Öğrenci masa işlemleri API tarafından yazılır. Öğrenci cihazındaki
            // eski doluluk bilgisi sunucunun boş masa kaydını ezmemelidir.
            const mergedRows = key === 'desks' && !adminDataMode
              ? remoteRows
              : ['desks', 'users'].includes(key)
                ? mergeRemoteWithPendingLocal(key, remoteRows, getLocalRows())
                : remoteRows;
            if (key === 'desks' && !adminDataMode) {
              granularBaselineRef.current.desks = rowsToMap(remoteRows);
              granularSeenRemoteRef.current.desks = true;
            }
            // Baseline eksik QR'ı taşıdığı için mevcut senkronizasyon yalnızca onarılan
            // masa belgelerini bir kez kaydeder; eski QR'lar değiştirilmez.
            applyRows(key === 'desks' ? normalizeDeskQrRows(mergedRows) : mergedRows);
            markGranularLoaded(key);
          }, error => { retry(error); setIsDataLoaded(true); });
          unsubs.push(unsub);
        };

        subscribeRows('sgmDesks', 'desks', () => desksRef.current, rows => {
          desksRef.current = rows;
          setDesks(rows);
        }, normalizeRemoteDesks);

        // Kota optimizasyonu: öğrenci cihazları yönetim arşivlerini gerçek zamanlı dinlemez.
        // Log / ihlal / geri bildirim koleksiyonları yalnızca yönetici paneli açıkken dinlenir.
        if (adminDataMode) {
          const logWindows = { audit: [], legacy: [] };
          const applyLogWindow = (bucket, rows) => {
            logWindows[bucket] = rows;
            const all = [...logWindows.audit, ...logWindows.legacy];
            const pending = Object.values(readAppendOutbox()).filter(item => item.bucket === 'sgmAudit').map(item => item.record);
            const filtered = [...new Map([...all, ...pending].map(row => [row.id, row])).values()]
              .filter(row => row?.id && !isRecordDeleted('logs', row.id))
              .sort((a,b) => Number(b.time) - Number(a.time)).slice(0,500);
            logsRef.current = filtered; setLogs(filtered);
          };
          subscribeRows('sgmAudit', 'logs', () => [], rows => applyLogWindow('audit', rows));
          subscribeRows('sgmLogs', 'logs', () => [], rows => {
            applyLogWindow('legacy', rows);
            return;
          });

          subscribeRows('sgmViolations', 'violations', () => violationRecordsRef.current, rows => {
            const filtered = rows
              .filter(x => x?.id && !isRecordDeleted('violations', x.id))
              .sort((a,b) => Number(b?.time || 0) - Number(a?.time || 0));
            violationRecordsRef.current = filtered;
            setViolationRecords(filtered);
          });

          subscribeRows('sgmFeedback', 'feedback', () => feedbackRecordsRef.current, rows => {
            const filtered = rows
              .filter(x => x?.id && !isRecordDeleted('feedback', x.id))
              .sort((a,b) => Number(b?.time || 0) - Number(a?.time || 0));
            feedbackRecordsRef.current = filtered;
            setFeedbackRecords(filtered);
          });
        } else {
          markGranularLoaded('logs');
          markGranularLoaded('violations');
          markGranularLoaded('feedback');
        }
      } catch (error) {
        retry(error);
        // Firebase o an kota/bağlantı hatası verirse uygulama localStorage ile çalışmaya devam etsin.
        granularSyncReadyRef.current = false;
        setIsDataLoaded(true);
        setTimeout(() => { isInitializingRef.current = false; }, 250);
      }
    };

    setupGranularSync();
    const reconnect = () => { if (Date.now() >= quotaBackoffUntilRef.current) setSyncRetryEpoch(value => value + 1); };
    window.addEventListener('online', reconnect);
    return () => {
      window.removeEventListener('online', reconnect);
      if (retryTimer) clearTimeout(retryTimer);
      cancelled = true;
      unsubs.forEach(unsub => { try { unsub(); } catch {} });
    };
  }, [fbUser, adminDataMode, syncRetryEpoch]);

  useEffect(() => {
    try {
      localStorage.setItem('sgm_settings', JSON.stringify(settings));
      localStorage.setItem('sgm_desks', JSON.stringify(desks));
      localStorage.setItem('sgm_users', JSON.stringify(users));
      localStorage.setItem('sgm_logs', JSON.stringify(logs));
      localStorage.setItem('sgm_violation_records', JSON.stringify(violationRecords));
      localStorage.setItem('sgm_feedback_records', JSON.stringify(feedbackRecords));
      localStorage.setItem('sgm_layout', JSON.stringify(layoutElements));
    } catch(e) {}

    if (!isDataLoaded || !fbUser || !db || !granularSyncReadyRef.current || adminUserSaveInFlightRef.current) return;
    if (Date.now() < Number(quotaBackoffUntilRef.current || 0)) return;

    // Hızlı art arda gelen state değişikliklerini normalde 900ms içinde tek turda birleştir.
    // QR ile masa alma/bırakma gibi kritik işlemler mevcut criticalDeskMutationRef üzerinden
    // gecikmeden (50ms) senkronize edilir. Her turda yalnızca değişmiş belge yazılır.
    if (granularWriteTimerRef.current) clearTimeout(granularWriteTimerRef.current);
    const snapshot = adminDataMode
      ? { settings, desks, users, logs, violationRecords, feedbackRecords, layoutElements }
      : { settings, desks, users, layoutElements };
    const isCritical = criticalDeskMutationRef.current === true;
    criticalDeskMutationRef.current = false;
    granularWriteTimerRef.current = setTimeout(() => {
      granularWriteChainRef.current = granularWriteChainRef.current
        .then(() => persistGranularStateNow(snapshot))
        .catch(() => {});
    }, isCritical ? 50 : 900);

    return () => {
      if (granularWriteTimerRef.current) clearTimeout(granularWriteTimerRef.current);
    };
  }, [settings, desks, users, logs, violationRecords, feedbackRecords, layoutElements, isDataLoaded, fbUser, adminDataMode]);

  // ============================================================
  // GERÇEK TELEFON PUSH BİLDİRİMİ - FIREBASE CLOUD MESSAGING (FCM)
  // ============================================================
  // Vercel Environment Variables içine VITE_FIREBASE_VAPID_KEY eklenmiş olmalıdır.
  // public/firebase-messaging-sw.js dosyasının da projede bulunması gerekir.
  //
  // Bu fonksiyon mevcut bildirim sistemini kaldırmaz.
  // Öğrencinin telefonunu FCM'e kaydeder ve token'ı o öğrencinin kullanıcı kaydına ekler.
  // Cloud Function daha sonra ihbar / yönetici mesajı oluştuğunda bu token'a gerçek push gönderir.
  const updateUserPushDebug = (userId, patch = {}) => {
    if (!userId) return;

    setUsers(prev => Array.isArray(prev)
      ? prev.map(u => u.id === userId ? { ...u, ...patch } : u)
      : prev
    );

    setCurrentUser(prev => {
      if (!prev || prev.id !== userId) return prev;
      return { ...prev, ...patch };
    });
  };

  const registerPhonePush = async (userId, force = false) => {
    if (!userId) return null;

    const markStage = (stage, extra = {}) => {
      updateUserPushDebug(userId, {
        pushLastStage: stage,
        pushLastAttemptAt: Date.now(),
        ...extra
      });
      console.log('[FCM]', stage, extra);
    };

    const fail = (stage, message, error = null) => {
      const errorCode = error?.code || error?.name || '';
      const errorMessage = error?.message || message || 'Bilinmeyen push kayıt hatası';

      console.warn('[FCM ERROR]', stage, error);

      updateUserPushDebug(userId, {
        pushEnabled: false,
        pushLastStage: stage,
        pushLastError: errorMessage,
        pushLastErrorCode: String(errorCode || ''),
        pushLastAttemptAt: Date.now()
      });

      pushRegistrationRef.current.working = false;
      return null;
    };

    try {
      markStage('1_baslatiliyor');

      if (!app) {
        return fail('1_firebase_app_yok', 'Firebase uygulaması başlatılamadı.');
      }

      if (!('serviceWorker' in navigator)) {
        return fail('2_service_worker_destegi_yok', 'Bu tarayıcı Service Worker desteklemiyor.');
      }

      if (pushRegistrationRef.current.working && !force) {
        markStage('2_onceki_kayit_devam_ediyor');
        return pushRegistrationRef.current.token || null;
      }

      markStage('2_fcm_destegi_kontrol_ediliyor');
      const supported = await Promise.race([
        isMessagingSupported().catch(() => false),
        new Promise(resolve => setTimeout(() => resolve(false), 8000))
      ]);

      if (!supported) {
        return fail(
          '2_fcm_destegi_yok',
          'Firebase Cloud Messaging desteği alınamadı veya destek kontrolü zaman aşımına uğradı.'
        );
      }

      markStage('3_fcm_destegi_var');

      if (!('Notification' in window)) {
        return fail('4_bildirim_api_yok', 'Bu tarayıcı Bildirim API desteği sunmuyor.');
      }

      if (Notification.permission === 'default' && force) {
        markStage('4_bildirim_izni_isteniyor');
        try {
          await Notification.requestPermission();
        } catch (error) {
          return fail('4_bildirim_izni_hatasi', 'Bildirim izni istenirken hata oluştu.', error);
        }
      }

      markStage('5_bildirim_izni_kontrol', {
        pushNotificationPermission: Notification.permission
      });

      if (Notification.permission !== 'granted') {
        return fail(
          '5_bildirim_izni_yok',
          Notification.permission === 'denied'
            ? 'Bildirim izni tarayıcı tarafından engellenmiş.'
            : 'Bildirim izni henüz verilmemiş.'
        );
      }

      const vapidKey = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();

      if (!vapidKey) {
        return fail('6_vapid_eksik', 'VITE_FIREBASE_VAPID_KEY tanımlı değil.');
      }

      markStage('6_vapid_bulundu', {
        pushVapidLength: vapidKey.length
      });

      pushRegistrationRef.current.working = true;

      const cfg = app.options || {};
      const swParams = new URLSearchParams({
        apiKey: cfg.apiKey || '',
        authDomain: cfg.authDomain || '',
        projectId: cfg.projectId || '',
        storageBucket: cfg.storageBucket || '',
        messagingSenderId: cfg.messagingSenderId || '',
        appId: cfg.appId || ''
      });

      const swUrl = `/firebase-messaging-sw.js?${swParams.toString()}`;
      markStage('7_service_worker_kaydi_basliyor', {
        pushServiceWorkerRequestedUrl: swUrl
      });

      let registration;
      try {
        registration = await Promise.race([
          navigator.serviceWorker.register(swUrl, {
            scope: '/',
            updateViaCache: 'none'
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Service Worker kaydı 12 saniye içinde tamamlanmadı.')),
              12000
            )
          )
        ]);
      } catch (error) {
        return fail(
          '7_service_worker_kayit_hatasi',
          'Firebase Messaging Service Worker kaydedilemedi.',
          error
        );
      }

      markStage('8_service_worker_kayit_oldu', {
        pushServiceWorkerScope: registration.scope || '',
        pushServiceWorkerUrl:
          registration.active?.scriptURL ||
          registration.waiting?.scriptURL ||
          registration.installing?.scriptURL ||
          ''
      });

      try {
        await registration.update();
      } catch (e) {}

      markStage('9_service_worker_hazir_bekleniyor');

      let readyRegistration;
      try {
        readyRegistration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Service Worker ready durumu 12 saniye içinde oluşmadı.')),
              12000
            )
          )
        ]);
      } catch (error) {
        return fail(
          '9_service_worker_ready_hatasi',
          'Service Worker kayıt oldu fakat aktif hale gelemedi.',
          error
        );
      }

      registration = readyRegistration || registration;

      markStage('10_service_worker_aktif', {
        pushServiceWorkerScope: registration.scope || '',
        pushServiceWorkerUrl:
          registration.active?.scriptURL ||
          registration.waiting?.scriptURL ||
          registration.installing?.scriptURL ||
          ''
      });

      const messaging = getMessaging(app);

      markStage('11_fcm_token_aliniyor');

      let token;
      try {
        token = await Promise.race([
          getToken(messaging, {
            vapidKey,
            serviceWorkerRegistration: registration
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('FCM token isteği 15 saniye içinde tamamlanmadı.')),
              15000
            )
          )
        ]);
      } catch (error) {
        return fail(
          '11_fcm_token_hatasi',
          'Firebase FCM token alınamadı.',
          error
        );
      }

      if (!token) {
        return fail('11_fcm_token_bos', 'Firebase FCM token üretmedi.');
      }

      await runStudentActivity('register-push-token', { token });

      pushRegistrationRef.current = {
        userId,
        token,
        working: false
      };

      markStage('12_token_kaydediliyor', {
        pushTokenPreview: `${token.slice(0, 12)}...${token.slice(-8)}`
      });

      setUsers(prev => Array.isArray(prev) ? prev.map(u => {
        if (u.id !== userId) return u;

        const previousTokens = Array.isArray(u.pushTokens)
          ? u.pushTokens.filter(Boolean)
          : [];

        const nextTokens = [
          token,
          ...previousTokens.filter(t => t !== token)
        ].slice(0, 5);

        return {
          ...u,
          pushTokens: nextTokens,
          pushEnabled: true,
          pushUpdatedAt: Date.now(),
          pushLastStage: '13_hazir',
          pushLastError: '',
          pushLastErrorCode: '',
          pushLastAttemptAt: Date.now(),
          pushServiceWorkerScope: registration.scope || '',
          pushServiceWorkerUrl:
            registration.active?.scriptURL ||
            registration.waiting?.scriptURL ||
            registration.installing?.scriptURL ||
            '',
          pushTokenPreview: `${token.slice(0, 12)}...${token.slice(-8)}`
        };
      }) : prev);

      setCurrentUser(prev => {
        if (!prev || prev.id !== userId) return prev;

        const previousTokens = Array.isArray(prev.pushTokens)
          ? prev.pushTokens.filter(Boolean)
          : [];

        const nextTokens = [
          token,
          ...previousTokens.filter(t => t !== token)
        ].slice(0, 5);

        return {
          ...prev,
          pushTokens: nextTokens,
          pushEnabled: true,
          pushUpdatedAt: Date.now(),
          pushLastStage: '13_hazir',
          pushLastError: '',
          pushLastErrorCode: '',
          pushLastAttemptAt: Date.now(),
          pushServiceWorkerScope: registration.scope || '',
          pushServiceWorkerUrl:
            registration.active?.scriptURL ||
            registration.waiting?.scriptURL ||
            registration.installing?.scriptURL ||
            '',
          pushTokenPreview: `${token.slice(0, 12)}...${token.slice(-8)}`
        };
      });

      console.log('Telefon push bildirimi aktif edildi. FCM token kullanıcıya kaydedildi.');
      return token;

    } catch (error) {
      return fail(
        '99_beklenmeyen_hata',
        error?.message || 'Telefon push kaydı sırasında beklenmeyen hata oluştu.',
        error
      );
    }
  };

  // Öğrenci sisteme giriş yaptığında daha önce bildirim izni verilmişse
  // telefonu otomatik olarak FCM'e kaydet.
  useEffect(() => {
    if (!currentUser?.id || !isDataLoaded) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    if (
      pushRegistrationRef.current.userId === currentUser.id &&
      pushRegistrationRef.current.token
    ) {
      return;
    }

    registerPhonePush(currentUser.id);
  }, [currentUser?.id, isDataLoaded]);

  // ============================================================
  // VERCEL SERVERLESS API ÜZERİNDEN GERÇEK TELEFON PUSH BİLDİRİMİ
  // ============================================================
  // api/send-push.js Vercel'de çalışır ve Firebase Admin SDK ile FCM push gönderir.
  // Mevcut tarayıcı / ekran içi bildirim sistemi aynen korunur.
  const pushOutboxKey = 'sgm_push_outbox';
  const readPushOutbox = () => { try { return JSON.parse(localStorage.getItem(pushOutboxKey) || '{}'); } catch { return {}; } };
  const performPushRequest = async request => {
    const currentAuth = auth?.currentUser;
    if (!currentAuth || !navigator.onLine) return { success: false, pending: true };
    const token = await currentAuth.getIdToken();
    const response = await fetch('/api/send-push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(request) });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success || payload?.skipped && payload?.reason === 'no-token' || response.status === 410) {
      const outbox = readPushOutbox(); delete outbox[request.logId]; localStorage.setItem(pushOutboxKey, JSON.stringify(outbox));
      return payload || { success: false, skipped: true, reason: 'deleted-user' };
    }
    return { success: false, pending: true, error: payload?.message || `Push HTTP ${response.status}` };
  };
  const flushPushOutbox = async () => {
    if (!db || !fbUser || !navigator.onLine || Date.now() < quotaBackoffUntilRef.current) return;
    for (const request of Object.values(readPushOutbox())) {
      if (readAppendOutbox()[`sgmAudit/${request.logId}`]) continue;
      try { await performPushRequest(request); } catch (error) { console.warn('Push bekliyor:', error.message); }
    }
  };
  const sendServerPush = async ({ userId, title, body, type = 'GENEL', deskId = null, logId = null }) => {
    if (!userId) return { success: false, skipped: true, reason: 'no-user' };
    if (['localhost','127.0.0.1'].includes(window.location.hostname)) return { success: true, skipped: true, reason: 'localhost' };
    const request = { userId, type, deskId, logId: logId || `test-${Date.now()}` };
    const outbox = readPushOutbox(); outbox[request.logId] = request;
    localStorage.setItem(pushOutboxKey, JSON.stringify(outbox));
    try {
      await appendChainRef.current;
      if (readAppendOutbox()[`sgmAudit/${request.logId}`]) return { success: false, pending: true, error: 'Olay kaydı sunucuya gönderilmeyi bekliyor.' };
      return await performPushRequest(request);
    } catch (error) { return { success: false, pending: true, error: error.message }; }
  };

  const retryMyPhonePushRegistration = async () => {
    if (!currentUser?.id) {
      showMessage(
        'Öğrenci Girişi Gerekli',
        'Telefon push kaydını yenilemek için önce öğrenci hesabıyla giriş yapın.',
        'warning'
      );
      return;
    }

    pushRegistrationRef.current = {
      userId: null,
      token: null,
      working: false
    };

    updateUserPushDebug(currentUser.id, {
      pushLastStage: 'manuel_yeniden_kayit',
      pushLastError: '',
      pushLastErrorCode: '',
      pushLastAttemptAt: Date.now()
    });

    const token = await registerPhonePush(currentUser.id, true);

    if (token) {
      showMessage(
        'Telefon Bildirimi Aktif',
        'FCM token başarıyla oluşturuldu ve hesabınıza kaydedildi.',
        'success'
      );
    } else {
      // React state güncellemesi asenkron olabileceği için kısa bir gecikmeden sonra
      // en güncel kullanıcı kaydındaki hata bilgisini göster.
      setTimeout(() => {
        const latestUser = (usersRef.current || []).find(
          u => u.id === currentUser.id
        );

        showMessage(
          'Push Kaydı Başarısız',
          latestUser?.pushLastError ||
            'FCM token oluşturulamadı. Yönetici panelindeki Push Durumu ekranından aşama ve hata bilgisini kontrol edin.',
          'danger'
        );
      }, 300);
    }
  };

  const sendNotification = async (title, body) => {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Mobil cihazlarda bildirim izni yoksa ya da desteklenmiyorsa sessizce çık.
    if (isMobile && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, {
          body,
          icon: '/favicon.ico'
        });
        return;
      }
    }

    // Masaüstü tarayıcılar için normal bildirim
    if (!isMobile) {
      new Notification(title, {
        body,
        icon: '/favicon.ico'
      });
    }
  } catch (error) {
    console.warn('Bildirim gönderilemedi:', error);
  }
};


  // Kapanışa TAM 1 saat / 30 dk / 15 dk kala aktif masa kullanıcılarına bildirim gönderir.
  // Her uyarı kapanıştan önceki ilgili 1 dakikalık pencere içinde yalnızca bir kez gösterilir.
  // Örn. kapanış 22:00 ise uyarılar 21:00, 21:30 ve 21:45'te tetiklenir.
  useEffect(() => {
    if (!currentUser || !currentUser.activeDeskId || !settings.closeTime) return;

    const d = new Date(now);
    const [closeH, closeM] = String(settings.closeTime || '22:00').split(':').map(Number);
    const closeAt = new Date(d);
    closeAt.setHours(closeH, closeM, 0, 0);
    const remainingMs = closeAt.getTime() - d.getTime();
    if (remainingMs <= 0) return;

    const remainingSeconds = Math.floor(remainingMs / 1000);
    const thresholds = [
      { key: '60', seconds: 60 * 60, label: '1 saat' },
      { key: '30', seconds: 30 * 60, label: '30 dakika' },
      { key: '15', seconds: 15 * 60, label: '15 dakika' }
    ];

    // Sadece ilgili dakikanın içinde çalışır. Böylece örneğin 21:10'da "1 saat kaldı" uyarısı verilmez.
    const threshold = thresholds.find(t => remainingSeconds <= t.seconds && remainingSeconds > t.seconds - 60);
    if (!threshold) return;

    const dayKey = getLocalDayKey(d);
    // Kapanış saati aynı gün değiştirilirse yeni saate ait uyarılar eski bildirim kayıtlarına takılmasın.
    // Örn. 22:00 için 1 saat uyarısı verilmiş olsa bile kapanış 23:00 yapılırsa 22:00'de yeni 1 saat uyarısı gönderilebilir.
    const closeTimeKey = String(settings.closeTime || '22:00').replace(':', '');
    const noticeKey = `${currentUser.id}-${dayKey}-${closeTimeKey}-${threshold.key}`;
    const storageKey = `sgm_closing_notice_${noticeKey}`;
    if (closingNotificationSeenRef.current.has(noticeKey) || localStorage.getItem(storageKey) === '1') return;

    closingNotificationSeenRef.current.add(noticeKey);
    try { localStorage.setItem(storageKey, '1'); } catch (e) {}

    const body = threshold.key === '60'
      ? `Kütüphane 1 saat sonra kapanacaktır, bilginize. Kapanış saati: ${settings.closeTime}. Kapanışta tüm masalar otomatik olarak boşaltılacaktır.`
      : threshold.key === '30'
        ? `Kütüphanenin kapanmasına 30 dakika kaldı, bilginize. Kapanış saati: ${settings.closeTime}. Kapanışta tüm masalar otomatik olarak boşaltılacaktır.`
        : `Kütüphanenin kapanmasına 15 dakika kaldı, bilginize. Kapanış saati: ${settings.closeTime}. Kapanışta tüm masalar otomatik olarak boşaltılacaktır.`;
    sendNotification('Kütüphane Kapanış Uyarısı', body);
    showMessage(
      'Kütüphane Kapanış Uyarısı',
      <div className="space-y-3">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="font-black text-amber-800">Kütüphane {threshold.label} sonra kapanacaktır.</p>
          <p className="text-sm text-amber-700 mt-1">Kapanış saati: <b>{settings.closeTime}</b></p>
        </div>
        <p className="text-sm text-slate-600">Saat {settings.closeTime} olduğunda tüm aktif kullanıcı ve bekleyen masa rezervasyonları otomatik sonlandırılacaktır.</p>
      </div>,
      'warning'
    );
    addLog('KAPANIS_BILDIRIMI', body, currentUser.activeDeskId, currentUser.id);
  }, [now, currentUser?.id, currentUser?.activeDeskId, settings.closeTime]);

  const getAuditCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'sgmAudit');
  const readAppendOutbox = () => {
    if (!appendOutboxRef.current) {
      try { appendOutboxRef.current = JSON.parse(localStorage.getItem('sgm_append_outbox') || '{}'); } catch { appendOutboxRef.current = {}; }
      // Preserve pending events created by the previous release, without replaying its whole log history.
      try {
        const legacy = JSON.parse(localStorage.getItem('sgm_audit_outbox') || '{}');
        Object.values(legacy).forEach(record => {
          const key = `sgmAudit/${record.id}`;
          if (!appendOutboxRef.current[key]) appendOutboxRef.current[key] = { bucket: 'sgmAudit', documentId: record.id, record };
        });
        localStorage.setItem('sgm_append_outbox', JSON.stringify(appendOutboxRef.current));
        localStorage.removeItem('sgm_audit_outbox');
      } catch {}
    }
    return appendOutboxRef.current;
  };
  const saveAppendOutbox = () => {
    try { localStorage.setItem('sgm_append_outbox', JSON.stringify(readAppendOutbox())); } catch (error) { console.warn('Bekleyen kayıtlar saklanamadı:', error); }
  };
  const isStudentAuditType = type => [
    'SISTEM_GIRIS', 'PIL_AYARI_BILGILENDIRME', 'OGRENCI_', 'ÖĞRENCİ_', 'İHBAR', 'IHBAR', 'GERIBILDIRIM_ACILDI',
    'MASA_', 'MOLA_', 'BILDIRIM_IPTAL', 'KISITLI_ISLEM_ENGELLENDI',
    'MASA_BEKLEME_ENGELLENDI', 'AYNI_', 'UYGULAMA_'
  ].some(prefix => String(type || '').startsWith(prefix)) && !String(type || '').includes('ADMIN');
  const bucketDeletionKey = bucket => ({ sgmAudit: 'logs', sgmLogs: 'logs', sgmViolations: 'violations', sgmFeedback: 'feedback' })[bucket];
  const persistAppendItem = async item => {
    if (!db || !fbUser || !navigator.onLine || Date.now() < quotaBackoffUntilRef.current) throw new Error('Kayıt cihazda bekliyor; bağlantı/kota düzeldiğinde gönderilecek.');
    if (!adminAuthorized) {
      if (item.delete) throw new Error('Öğrenci oturumu geçmiş kayıtları silemez.');
      if (item.bucket === 'sgmFeedback') {
        await runStudentActivity('feedback', { id: item.record.id, type: item.record.type, message: item.record.message });
      } else if (item.bucket === 'sgmAudit') {
        await runStudentActivity('audit-event', { record: item.record });
      } else {
        throw new Error('Bu kayıt türü yalnızca yönetici tarafından yazılabilir.');
      }
      const key = `${item.bucket}/${item.documentId}`;
      if (stableJson(readAppendOutbox()[key]) === stableJson(item)) delete readAppendOutbox()[key];
      saveAppendOutbox();
      return;
    }
    const deletionBucket = bucketDeletionKey(item.bucket);
    await runTransaction(db, async tx => {
      const target = getLiveDoc(item.bucket, item.documentId);
      const reads = [tx.get(target)];
      if (deletionBucket) reads.push(tx.get(getLiveDoc('sgmDeletedRecords', `${deletionBucket}-${item.record.id}`)));
      const [snap, marker] = await Promise.all(reads);
      if (item.delete) {
        if (deletionBucket && !marker?.exists()) tx.set(getLiveDoc('sgmDeletedRecords', `${deletionBucket}-${item.record.id}`), { id: item.record.id, deletedAt: Date.now() });
        if (snap.exists()) tx.delete(target);
        return;
      }
      if (marker?.exists() || deletionBucket && isRecordDeleted(deletionBucket, item.record.id)) return;
      if (!snap.exists() || item.replace && Number(snap.data().time || 0) < Number(item.record.time || 0)) tx.set(target, item.record);
    });
    // A newer message may have replaced this pending item during the request.
    const key = `${item.bucket}/${item.documentId}`;
    if (stableJson(readAppendOutbox()[key]) === stableJson(item)) delete readAppendOutbox()[key];
    saveAppendOutbox();
  };
  const flushAuditOutbox = async () => {
    if (!db || !fbUser || !navigator.onLine || Date.now() < quotaBackoffUntilRef.current) return;
    for (const item of Object.values(readAppendOutbox())) {
      const bucket = bucketDeletionKey(item.bucket);
      if (!adminAuthorized && (item.bucket === 'sgmFeedback'
        ? !['complaint', 'suggestion'].includes(item.record?.type)
        : item.bucket !== 'sgmAudit' || !isStudentAuditType(item.record?.type))) {
        console.warn('Yönetici yetkisi gerektiren bekleyen kayıt öğrenci oturumundan gönderilmedi:', item.bucket, item.record?.id);
        delete readAppendOutbox()[`${item.bucket}/${item.documentId}`];
        saveAppendOutbox();
        continue;
      }
      if (!item.delete && bucket && isRecordDeleted(bucket, item.record.id)) {
        delete readAppendOutbox()[`${item.bucket}/${item.documentId}`]; saveAppendOutbox(); continue;
      }
      try { await persistAppendItem(item); } catch (error) { handleFirestoreQuotaError(error); break; }
    }
    if (pendingUserDeletesRef.current.size && adminAuthorized) {
      for (const id of Array.from(pendingUserDeletesRef.current)) {
        try {
          const result = await cloudActions.deleteUser(id, desksRef.current);
          applyCloudRows(result);
          granularBaselineRef.current.users.delete(id);
          pendingUserDeletesRef.current.delete(id);
          localStorage.setItem('sgm_pending_user_deletes', JSON.stringify(Array.from(pendingUserDeletesRef.current)));
        } catch (error) { handleFirestoreQuotaError(error); break; }
      }
    }
  };
  const queueAppend = (bucket, record, options = {}) => {
    const documentId = options.documentId || record.id;
    const item = { bucket, documentId, record, replace: options.replace === true, delete: options.delete === true };
    readAppendOutbox()[`${bucket}/${documentId}`] = item;
    saveAppendOutbox();
    appendChainRef.current = appendChainRef.current.catch(() => {}).then(async () => {
      try { await persistAppendItem(item); } catch (error) { handleFirestoreQuotaError(error); }
    });
    return appendChainRef.current;
  };
  const archiveLog = record => queueAppend('sgmAudit', record);

  const deleteArchivedLogIds = ids => {
    ids.forEach(id => {
      queueAppend('sgmAudit', { id }, { delete: true });
      queueAppend('sgmLogs', { id }, { delete: true });
    });
  };
  const deleteHistoryRecords = (bucket, ids) => {
    const collection = { violations: 'sgmViolations', feedback: 'sgmFeedback' }[bucket];
    if (collection) ids.forEach(id => queueAppend(collection, { id }, { delete: true }));
  };

  const loadArchivedLogs = async () => {
    if (archiveLoading) return;
    setArchiveLoading(true);
    try {
      if (db && fbUser) {
        const pages = await Promise.all(['sgmAudit','sgmLogs'].map(async bucket => {
          const constraints = [orderBy('time', 'desc'), limit(500)];
          if (archiveCursorRef.current[bucket]) constraints.push(startAfter(archiveCursorRef.current[bucket]));
          const result = await getDocs(query(getLiveCollection(bucket), ...constraints));
          if (result.docs.length) archiveCursorRef.current[bucket] = result.docs[result.docs.length - 1];
          return result.docs.map(doc => doc.data());
        }));
        const records = [...new Map(pages.flat().filter(log => !isRecordDeleted('logs', log.id)).map(log => [log.id,log])).values()];
        setArchivedLogs(prev => [...new Map([...prev, ...records].map(l => [l.id, l])).values()]);
        addLog('LOG_ARSIV_GORUNTULE', `${records.length} arşiv kaydı getirildi.`);
      } else {
        setArchivedLogs(Object.values(readAppendOutbox()).filter(item => item.bucket === 'sgmAudit' && !item.delete && !isRecordDeleted('logs', item.record.id)).map(item => item.record));
        addLog('LOG_ARSIV_GORUNTULE', 'Yerel işlem arşivi görüntülendi.');
      }
    } catch (error) { showMessage('Arşiv Alınamadı', 'Kayıt arşivine erişilemedi. Bağlantınızı ve Firestore erişim izinlerini kontrol edin.', 'warning'); }
    finally { setArchiveLoading(false); }
  };
  useEffect(() => {
    if (!isDataLoaded) return;
    const flush = () => { appendChainRef.current = appendChainRef.current.catch(() => {}).then(flushAuditOutbox).then(flushPushOutbox).catch(() => {}); };
    // Yalnızca kuyrukta bekleyen YENİ kayıtları gönder. Eski logları her cihaz açılışında tekrar arşivleme.
    flush(); window.addEventListener('online', flush);
    const timer = setInterval(flush, 15000);
    return () => { clearInterval(timer); window.removeEventListener('online', flush); };
  }, [isDataLoaded, fbUser, adminAuthorized, syncRetryEpoch]);

  const addLog = (type, message, deskId = null, userId = null, _legacyFlag = false, forcedLocation = null, extraData = null) => {
    const safeUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const u = safeUsers.find(x => x.id === userId);
    const userInfo = u ? `${u.name} (GM: ${u.specialCode})` : (currentUser ? `${currentUser.name} (GM: ${currentUser.specialCode})` : view === 'admin_dash' ? 'Yönetici' : 'Sistem / Anonim');
    const devInfo = (u && u.deviceId) ? u.deviceId : deviceId;

    const newLog = {
      id: extraData?.eventId || (['SİSTEM_OTOMATİK','GUNLUK_MOLA_HAKLARI_YENILENDI','GUNLUK_IHLALLER_SIFIRLANDI','IHLAL_DINAMIK_GUVENLIK_KONTROL_LOGU'].includes(type) ? `${type}-${getLocalDayKey()}-${settings.closeTime || ''}` : generateId()),
      time: Date.now(),
      type,
      message,
      deskId,
      userId,
      userInfo,
      actorFirebaseUid: auth?.currentUser?.uid || null,
      actorId: view === 'admin_dash' ? 'ADMIN' : currentUser?.id || 'SYSTEM',
      actorInfo: view === 'admin_dash' ? 'Yönetici' : currentUser?.specialCode || 'Sistem / Anonim',
      deviceInfo: devInfo,
      locationInfo: forcedLocation || userLocation,
      ...(extraData && typeof extraData === 'object' ? Object.fromEntries(Object.entries(extraData).filter(([,value]) => value !== undefined)) : {})
    };

    // Ref'i anında güncelle: mesaj Firestore snapshot'ı tarafından ezilmesin.
    const currentLogs = Array.isArray(logsRef.current) ? logsRef.current : [];
    const nextLogs = [newLog, ...currentLogs.filter(log => log?.id !== newLog.id)]
      .sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0))
      .slice(0, 500);

    logsRef.current = nextLogs;
    setLogs(nextLogs);
    try { localStorage.setItem('sgm_logs', JSON.stringify(nextLogs)); } catch {}
    const studentEvent = isStudentAuditType(type);
    if (adminAuthorized || studentEvent) archiveLog(newLog);
    if (type === 'ADMIN_MASA_MESAJI' && userId) queueAppend('sgmMessages', newLog, { documentId: userId, replace: true });
    // One canonical event document. Students never listen to the global archive.

    if (adminAuthorized && String(type || '').startsWith('IHLAL')) {
      const violationRecord = {
        id: `VIOL-${newLog.id}`,
        sourceLogId: newLog.id,
        time: newLog.time,
        type: newLog.type,
        message: newLog.message,
        deskId: newLog.deskId || null,
        userId: newLog.userId || null,
        userInfo: newLog.userInfo,
        deviceInfo: newLog.deviceInfo,
        locationInfo: newLog.locationInfo
      };
      const currentViolations = Array.isArray(violationRecordsRef.current) ? violationRecordsRef.current : [];
      const nextViolations = [violationRecord, ...currentViolations.filter(r => r?.id !== violationRecord.id)]
        .sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0))
        .slice(0, 5000);
      violationRecordsRef.current = nextViolations;
      setViolationRecords(nextViolations);
      queueAppend('sgmViolations', violationRecord);
    }

    return newLog;
  };

  const appOpenLoggedRef = useRef(false);
  const restoredLoginLoggedRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded || !granularLoadedRef.current.settings && db) return;
    if (!appOpenLoggedRef.current) {
      appOpenLoggedRef.current = true;
      addLog('SISTEM_GIRIS', 'Uygulama açıldı; sistem verileri yüklendi.', null, currentUser?.id || null);
    }
    if (currentUser && !restoredLoginLoggedRef.current) {
      restoredLoginLoggedRef.current = true;
      const desk = desksRef.current.find(d => d.occupant === currentUser.id || d.guestOccupant === currentUser.id);
      addLog('OGRENCI_OTURUM_ACILDI', 'Öğrenci oturumu açıldı / yeniden yüklendi.', desk?.id || null, currentUser.id, false, null, {
        deskStatus: desk?.status || 'masasiz',
        onBreak: desk?.occupant === currentUser.id ? desk.status === 'on_break' : Number(desk?.guestBreakEndTime || 0) > Date.now()
      });
    }
    if (!currentUser) restoredLoginLoggedRef.current = false;
  }, [isDataLoaded, currentUser?.id, fbUser, settings, desks]);

  // Son kapanıştan önce başlamış oturumları açılışta yakala. İşlem sunucudaki
  // güncel masa ve kullanıcıları tekrar okuyarak yeni günün masalarını korur.
  // Sunucu cron'u yerine geçmez: çevrimiçi temizlik için yönetici oturumu gerekir.
  const closingRecoveryBusyRef = useRef(false);
  const recoverPreviousClosing = async () => {
    if (!isDataLoaded || (db && (!adminAuthorized || !fbUser || !navigator.onLine)) || closingRecoveryBusyRef.current) return;
    if (db && (!granularLoadedRef.current.desks || !granularLoadedRef.current.users || !granularLoadedRef.current.settings)) return;
    const cutoff = getLastClosingAt(settingsRef.current.closeTime);
    if (!cutoff) return;
    const candidates = desksRef.current.filter(d => hasSessionBeforeClosing(d, cutoff));
    if (!candidates.length) return;
    closingRecoveryBusyRef.current = true;
    try {
      for (const candidate of candidates) {
        const clean = async (tx) => {
          const deskRef = db ? getLiveDoc('sgmDesks', candidate.id) : null;
          const snap = tx ? await tx.get(deskRef) : null;
          const desk = tx ? (snap.exists() ? { ...snap.data(), id: candidate.id } : null) : desksRef.current.find(d => d.id === candidate.id);
          if (!desk || !hasSessionBeforeClosing(desk, cutoff)) return null;
          const ids = [...new Set([desk.occupant, desk.guestOccupant, desk.pendingOccupant].filter(Boolean))];
          const related = [];
          for (const id of ids) {
            const userRef = db ? getLiveDoc('sgmUsers', id) : null;
            const userSnap = tx ? await tx.get(userRef) : null;
            const user = tx ? (userSnap.exists() ? { ...userSnap.data(), id } : null) : usersRef.current.find(u => u.id === id);
            if (user) related.push({ userRef, user });
          }
          const clearedDesk = clearClosedDesk(desk);
          const clearedUsers = related.map(({user}) => ({ ...user,
            ...(Number(user.activeDeskId) === Number(desk.id) ? {activeDeskId: null, activeDeskRole: null} : {}),
            ...(Number(user.pendingDeskId) === Number(desk.id) ? {pendingDeskId: null, pendingDeskDeadline: null} : {})
          }));
          const event = {
            id: `close-recovery-${cutoff}-${desk.id}`, time: Date.now(), type: 'KAPANIS_MASA_OTOMATIK_BOSALTILDI',
            message: `Önceki kapanıştan kalan Masa ${desk.id} oturumu boşaltıldı.`, deskId: desk.id,
            userId: desk.occupant || desk.pendingOccupant || desk.guestOccupant || null,
            actorId: 'ADMIN', actorFirebaseUid: auth?.currentUser?.uid || null, actorInfo: 'Yönetici',
            previousStatus: desk.status, closingAt: cutoff, previousSessionStartTime: desk.sessionStartTime || null
          };
          if (tx) {
            tx.set(deskRef, clearedDesk);
            related.forEach(({userRef}, i) => tx.set(userRef, clearedUsers[i], { merge: true }));
            tx.set(getLiveDoc('sgmAudit', event.id), event);
          }
          return {desk: clearedDesk, users: clearedUsers, event};
        };
        const result = db ? await runTransaction(db, clean) : await clean(null);
        if (!result) continue;
        applyCloudRows({desk: result.desk});
        result.users.forEach(user => applyCloudRows({user}));
        // Sunucu işlemi logu da atomik yazdı; arşive ikinci kez gönderme.
        const nextLogs = [result.event, ...logsRef.current.filter(l => l.id !== result.event.id)].slice(0, 500);
        logsRef.current = nextLogs; setLogs(nextLogs);
        localStorage.setItem('sgm_desks', JSON.stringify(desksRef.current));
        localStorage.setItem('sgm_users', JSON.stringify(usersRef.current));
        localStorage.setItem('sgm_logs', JSON.stringify(nextLogs));
        if (!db) archiveLog(result.event);
      }
    } catch (error) { handleFirestoreQuotaError(error); }
    finally { closingRecoveryBusyRef.current = false; }
  };
  useEffect(() => {
    const recover = () => { recoverPreviousClosing(); };
    recover();
    const timer = setInterval(recover, 15000);
    const resume = () => { if (!document.hidden) recover(); };
    window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(timer); window.removeEventListener('online', recover); document.removeEventListener('visibilitychange', resume); };
  }, [isDataLoaded, adminAuthorized, fbUser, settings.closeTime, desks]);

  const runFullDayCleanup = ({ source = 'manual', cleanupTime = Date.now(), dayKey = getLocalDayKey(), dayLabel = new Date().toDateString(), writeAutoCloseMarker = false } = {}) => {
    const beforeDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
    const beforeUsers = Array.isArray(usersRef.current) ? usersRef.current : [];

    const activeDesks = beforeDesks.filter(desk =>
      desk?.occupant ||
      desk?.guestOccupant ||
      desk?.pendingOccupant ||
      ['occupied', 'on_break', 'reported'].includes(desk?.status)
    );

    const usersWithDailyViolations = beforeUsers.filter(
      u => Number.isFinite(Number(u?.strikes)) && Number(u.strikes) > 0
    );

    // Temizlikten ÖNCE gerekli gün sonu yedeğini localStorage'a al.
    // Son 30 yedek tutulur; kalıcı violationRecords geçmişine dokunulmaz.
    try {
      const oldBackups = JSON.parse(localStorage.getItem('sgm_day_end_backups') || '[]');
      const backup = {
        id: `BACKUP-${cleanupTime}-${generateId()}`,
        createdAt: cleanupTime,
        dayKey,
        source,
        desks: beforeDesks,
        users: beforeUsers,
        logs: Array.isArray(logsRef.current) ? logsRef.current : [],
        violationRecords: Array.isArray(violationRecordsRef.current) ? violationRecordsRef.current : [],
        feedbackRecords: Array.isArray(feedbackRecordsRef.current) ? feedbackRecordsRef.current : []
      };
      const nextBackups = [backup, ...(Array.isArray(oldBackups) ? oldBackups : [])].slice(0, 30);
      localStorage.setItem('sgm_day_end_backups', JSON.stringify(nextBackups));
      localStorage.setItem('sgm_last_day_end_backup_at', String(cleanupTime));
    } catch (e) {
      console.warn('Gün sonu yedeği localStorage yazılamadı:', e);
    }

    // Günlük ihlaller sıfırlanmadan önce kalıcı ihlal arşivine özet kaydı düş.
    usersWithDailyViolations.forEach(u => {
      const strikeCount = Number(u.strikes) || 0;
      addLog(
        String(source).startsWith('auto_') ? 'IHLAL_GUN_SONU_ARSIV' : 'IHLAL_MANUEL_GUN_SONU_ARSIV',
        `${u?.name || 'Öğrenci'} için ${String(source).startsWith('auto_') ? '22:00 kapanışında' : 'manuel gün sonu temizliğinde'} ${strikeCount} günlük ihlal arşivlendi; sayaç sıfırlanmadan önce kalıcı kayda işlendi.`,
        u?.activeDeskId || null,
        u?.id || null,
        false,
        null,
        {
          dailyStrikeCount: strikeCount,
          archiveReason: String(source).startsWith('auto_') ? '22:00_kapanis' : 'manuel_gun_sonu',
          archivedAt: cleanupTime,
          eventId: String(source).startsWith('auto_') ? `close-violations-${dayKey}-${settings.closeTime}-${u.id}` : undefined
        }
      );
    });

    // Boşaltılacak masaları tek tek logla.
    activeDesks.forEach(desk => {
      addLog(
        String(source).startsWith('auto_') ? 'KAPANIS_MASA_OTOMATIK_BOSALTILDI' : 'MANUEL_GUN_SONU_MASA_BOSALTILDI',
        `${String(source).startsWith('auto_') ? `Saat ${settings.closeTime || '22:00'} kapanışında` : 'Yönetici manuel gün sonu temizliğinde'} Masa ${desk.id} boşaltıldı.`,
        desk.id,
        desk.occupant || desk.guestOccupant || desk.pendingOccupant || null,
        false,
        null,
        {
          previousStatus: desk.status || null,
          hadOwner: !!desk.occupant,
          hadGuest: !!desk.guestOccupant,
          hadPendingReservation: !!desk.pendingOccupant,
          cleanedAt: cleanupTime,
          eventId: String(source).startsWith('auto_') ? `close-desk-${dayKey}-${settings.closeTime}-${desk.id}` : undefined
        }
      );
    });

    const resetDesks = beforeDesks.map(d => ({
      ...d,
      status: d.status === 'disabled' ? 'disabled' : 'available',
      occupant: null,
      ownerDeviceId: null,
      guestOccupant: null,
      guestSessionStartTime: null,
      guestBreakEndTime: null,
      guestReported: false,
      guestReportEndTime: null,
      guestReportIssuedAt: null,
      guestReportVerifiedAt: null,
      pendingOccupant: null,
      pendingDeskRole: null,
      pendingDeskDeadline: null,
      breakEndTime: null,
      reportEndTime: null,
      reportIssuedAt: null,
      reportVerifiedAt: null,
      sessionStartTime: null
    }));

    const resetUsers = beforeUsers.map(u => ({
      ...u,
      activeDeskId: null,
      activeDeskRole: null,
      pendingDeskId: null,
      pendingDeskDeadline: null,
      strikes: 0,
      violationsResetDate: dayKey,
      lastActiveTime: cleanupTime
    }));

    // KRİTİK: Ref + state + localStorage aynı turda güncellenir.
    // Önceki sürümde sadece setState yapıldığı için gecikmiş Firestore snapshot'ı
    // 22:00 temizliğini geri alabiliyordu; bu da masaların daha geç boş görünmesine yol açıyordu.
    dayEndCleanupGuardRef.current = {
      cleanedAt: cleanupTime,
      dayKey,
      source,
      expiresAt: cleanupTime + 120000
    };
    confirmedDeskGuardRef.current = null;
    releasedDeskGuardRef.current = null;
    pendingReservationGuardRef.current = null;

    desksRef.current = resetDesks;
    usersRef.current = resetUsers;
    criticalDeskMutationRef.current = true;

    setDesks(resetDesks);
    setUsers(resetUsers);

    try {
      localStorage.setItem('sgm_desks', JSON.stringify(resetDesks));
      localStorage.setItem('sgm_users', JSON.stringify(resetUsers));
      if (writeAutoCloseMarker) localStorage.setItem('sgm_last_close', dayLabel);
    } catch (e) {
      console.warn('Gün sonu temizliği localStorage yazma uyarısı:', e);
    }

    // Closing clears desks and reservations, not the student's account session.
    setSelectedDeskId(null); setDeskSelectionDeadline(null);
    setScannerConfig({ isOpen: false, mode: null, title: '' });

    addLog(
      String(source).startsWith('auto_') ? 'SISTEM_2200_KAPANIS_OZETI' : 'SISTEM_MANUEL_GUN_SONU_OZETI',
      String(source).startsWith('auto_')
        ? `22:00 kapanış kontrolü tamamlandı. ${activeDesks.length} aktif/rezerve masa ANINDA boşaltıldı, ${usersWithDailyViolations.length} kullanıcının günlük ihlali arşivlenip sıfırlandı ve gün sonu yedeği alındı.`
        : `Manuel gün sonu temizliği tamamlandı. ${activeDesks.length} aktif/rezerve masa boşaltıldı, ${usersWithDailyViolations.length} kullanıcının günlük ihlali arşivlenip sıfırlandı ve gün sonu yedeği alındı.`,
      null,
      null,
      false,
      null,
      {
        activeDeskCount: activeDesks.length,
        violationUserCount: usersWithDailyViolations.length,
        checkedAt: cleanupTime,
        backupTaken: true,
        cleanupSource: source,
        eventId: String(source).startsWith('auto_') ? `close-summary-${dayKey}-${settings.closeTime}` : undefined
      }
    );

    // Firestore'a useEffect'i beklemeden yalnızca değişen masa ve kullanıcı belgelerini gönder.
    // Böylece 22:00 temizliği anında yayınlanır ama dev allData belgesi tekrar yazılmaz.
    if (isDataLoaded && fbUser && db) {
      granularWriteChainRef.current = granularWriteChainRef.current
        .then(() => persistGranularStateNow({ desks: resetDesks, users: resetUsers }))
        .catch(error => handleFirestoreQuotaError(error));
    }

    return {
      activeDeskCount: activeDesks.length,
      violationUserCount: usersWithDailyViolations.length
    };
  };

  const showMessage = (title, content, type = 'info', onClose = null) => {
    setModal({
      isOpen: true, title, content, type,
      onClose: () => { setModal(prev => ({ ...prev, isOpen: false })); if (onClose) onClose(); }
    });
  };
  const closeMessage = () => setModal(prev => ({ ...prev, isOpen: false }));

  const settleCloudExpiry = async deskId => {
    if (expiredDeskJobsRef.current.has(deskId) || !fbUser || !navigator.onLine || Date.now() < quotaBackoffUntilRef.current) return;
    expiredDeskJobsRef.current.add(deskId);
    try {
      const result = adminAuthorized
        ? await cloudActions.expireDesk(deskId)
        : await runStudentDeskAction('expire', { deskId });
      if (!result) return;
      applyCloudRows(result);
      if (result.verified) return;
      const userId = result.user?.id;
      if (result.mode === 'reservation') {
        addLog('MASA_REZERVASYON_SURE_DOLDU', `Masa ${deskId} için 5 dakikalık QR rezervasyonu sona erdi.`, deskId, userId, false, null, { eventId: result.eventId });
        if (currentUser?.id === userId && Number(selectedDeskId) === Number(deskId)) { setSelectedDeskId(null); setDeskSelectionDeadline(null); }
      } else {
        addLog('IHLAL', `Masa ${deskId} ${result.mode === 'break_timeout' ? 'mola süresi aşıldığı' : 'ihbar QR ile doğrulanmadığı'} için boşaltıldı. Toplam ihlal: ${result.user?.strikes || 0}`, deskId, userId, false, null, { eventId: result.eventId });
        if (currentUser?.id === userId) {
          sendNotification('İhlal: Masanız Boşaltıldı', `Masa ${deskId} otomatik boşaltıldı.`);
          showMessage('Masanız Otomatik Boşaltıldı', 'İhlal nedeniyle masanız boşaltıldı. Bu masayı bugün tekrar alamazsınız. Son 7 günde ikinci ihlalde 7 günlük kısıtlama uygulanır.', 'danger');
        }
      }
    } catch (error) { handleFirestoreQuotaError(error); }
    finally { expiredDeskJobsRef.current.delete(deskId); }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (auth && !isDataLoaded) return; // EKLENDİ: Veritabanı bağlıysa veri yüklenene kadar boş lokal verinin sistemi ezmesini engelle
      
      const currentTime = Date.now();
      setNow(currentTime);

      const d = new Date();
      const currentHourMin = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const currentTimeMin = d.getHours() * 60 + d.getMinutes();
      const todayStr = d.toLocaleDateString('tr-TR');
      const todayKey = getLocalDayKey(d);
      const [closeH, closeM] = (settings.closeTime || '22:00').split(':').map(Number);
      const closeTimeMin = closeH * 60 + closeM;
      
      let needUserReset = false;
      let needDeskReset = false;
      // Kapanıştan 1 saat sonraki ikinci güvenlik kontrolü için ayrı bayrak.
      // Örn. 22:00 kapanış -> 23:00 kontrol, 23:00 kapanış -> 00:00 kontrol.
      let needSafetyReset2300 = false;

      // Gün değiştiği anda mola hakları yenilenir. Sistem gece kapalı kaldıysa ilk açılışta da yakalanır.
      const usersForDailyBreakCheck = Array.isArray(usersRef.current) ? usersRef.current : [];
      const hasUserWithOldBreakDay = usersForDailyBreakCheck.some(u => u.breaksResetDate !== todayKey);
      const hasUserWithOldViolationDay = usersForDailyBreakCheck.some(u => u.violationsResetDate !== todayKey);
      if (hasUserWithOldBreakDay || hasUserWithOldViolationDay) {
         needUserReset = true;
         if (hasUserWithOldBreakDay) {
           addLog('GUNLUK_MOLA_HAKLARI_YENILENDI', `Yeni gün (${todayKey}) başladı. Tüm öğrencilerin kısa ve uzun mola hakları yeniden tanımlandı.`);
         }
         if (hasUserWithOldViolationDay) {
           addLog('GUNLUK_IHLALLER_SIFIRLANDI', `Yeni gün (${todayKey}) başladı. Günlük ihlal sayaçları sıfırlandı; geçmiş ihlal kayıtları korundu.`);
         }
      }

      if (settings.openTime && currentHourMin === settings.openTime && localStorage.getItem('sgm_last_reset') !== todayStr) {
         needUserReset = true;
         try { localStorage.setItem('sgm_last_reset', todayStr); } catch(e){}
         addLog('SİSTEM_OTOMATİK', 'Yeni gün başlangıcı: Tüm mola ve ihlal hakları sıfırlandı.');
      }

      if ((!db || adminAuthorized) && settings.closeTime && !checkLibraryOpen() && currentTimeMin >= closeTimeMin && localStorage.getItem('sgm_last_close') !== todayStr) {
         // 22:00 kapanışında sadece bildirim/log değil, masa + kullanıcı + localStorage + Firestore
         // aynı işlem içinde temizlenir. İşaret, temizlik başlatıldıktan sonra yazılır.
         runFullDayCleanup({
           source: 'auto_close_time',
           cleanupTime: currentTime,
           dayKey: todayKey,
           dayLabel: todayStr,
           writeAutoCloseMarker: true
         });

         // Temizlik runFullDayCleanup içinde tamamlandığı için aşağıdaki ortak reset bloğunun
         // aynı turda ikinci kez çalışmasına gerek yok.
         needDeskReset = false;
      }

      // KAPANIŞTAN 1 SAAT SONRA İKİNCİ GÜVENLİK KONTROLÜ
      // Örn:
      // Kapanış 22:00 -> güvenlik kontrolü 23:00
      // Kapanış 23:00 -> güvenlik kontrolü 00:00
      // Kapanış 23:30 -> güvenlik kontrolü 00:30
      //
      // Gece yarısını aşan güvenlik kontrolü yalnızca yeni günün açılış saatine kadar çalışır.
      // Böylece örneğin 23:00 kapanış / 00:00 güvenlik kontrolünde uygulama sabah 10:00'da
      // açılırsa yeni günün aktif masaları yanlışlıkla temizlenmez.
      const safetyRawMin = closeTimeMin + 60;
      const safetyCheckMin = safetyRawMin % (24 * 60);
      const safetyWrapsToNextDay = safetyRawMin >= (24 * 60);
      const [openHForSafety, openMForSafety] = (settings.openTime || '07:00').split(':').map(Number);
      const openTimeMinForSafety = openHForSafety * 60 + openMForSafety;

      const safetyHour = Math.floor(safetyCheckMin / 60);
      const safetyMinute = safetyCheckMin % 60;
      const safetyTimeLabel = `${String(safetyHour).padStart(2, '0')}:${String(safetyMinute).padStart(2, '0')}`;
      const safetyTimeKey = safetyTimeLabel.replace(':', '');

      // Gece yarısı aşılmıyorsa güvenlik saatinden gün sonuna kadar;
      // aşılıyorsa güvenlik saatinden bir sonraki açılış saatine kadar güvenli pencere.
      const safetyWindowReached = safetyWrapsToNextDay
        ? (currentTimeMin >= safetyCheckMin && currentTimeMin < openTimeMinForSafety)
        : currentTimeMin >= safetyCheckMin;

      const safetyMarkerKey = `sgm_last_dynamic_safety_check_v3_${safetyTimeKey}`;

      if (
        (!db || adminAuthorized) && safetyWindowReached &&
        localStorage.getItem(safetyMarkerKey) !== todayStr
      ) {
         const desksAtSafety = Array.isArray(desksRef.current) ? desksRef.current : [];
         const usersAtSafety = Array.isArray(usersRef.current) ? usersRef.current : [];

         const activeDesksAtSafety = desksAtSafety.filter(desk =>
           desk?.occupant ||
           desk?.guestOccupant ||
           desk?.pendingOccupant ||
           ['occupied', 'on_break', 'reported'].includes(desk?.status)
         );

         const usersWithViolationsAtSafety = usersAtSafety.filter(
           u => Number.isFinite(Number(u?.strikes)) && Number(u.strikes) > 0
         );

         // Önce mevcut günlük ihlalleri kalıcı İhlal Kayıtları arşivine yaz.
         usersWithViolationsAtSafety.forEach(u => {
           const strikeCount = Number(u.strikes) || 0;
           addLog(
             'IHLAL_DINAMIK_GUVENLIK_ARSIV',
             `${u?.name || 'Öğrenci'} için ${safetyTimeLabel} ikinci güvenlik kontrolünde ${strikeCount} günlük ihlal bulundu. Günlük sayaç sıfırlanmadan önce kalıcı İhlal Kayıtları arşivine işlendi.`,
             u?.activeDeskId || null,
             u?.id || null,
             false,
             null,
             {
               dailyStrikeCount: strikeCount,
               archiveReason: 'dinamik_guvenlik_kontrolu',
               closeTime: settings.closeTime,
               safetyTime: safetyTimeLabel,
               archivedAt: currentTime
             }
           );
         });

         // Temizlenecek her aktif/rezerve masayı Sistem Kayıtları'na ayrı ayrı yaz.
         activeDesksAtSafety.forEach(desk => {
           addLog(
             'DINAMIK_GUVENLIK_MASA_OTOMATIK_BOSALTILDI',
             `${safetyTimeLabel} ikinci güvenlik kontrolünde Masa ${desk.id} hâlâ aktif/rezerve göründüğü için otomatik boşaltıldı.`,
             desk.id,
             desk.occupant || desk.guestOccupant || desk.pendingOccupant || null,
             false,
             null,
             {
               previousStatus: desk.status || null,
               hadOwner: !!desk.occupant,
               hadGuest: !!desk.guestOccupant,
               hadPendingReservation: !!desk.pendingOccupant,
               closeTime: settings.closeTime,
               safetyTime: safetyTimeLabel,
               checkedAt: currentTime
             }
           );
         });

         // Ref + state + localStorage aynı anda temizlenir.
         const resetDesksSafety = desksAtSafety.map(desk => ({
           ...desk,
           status: desk.status === 'disabled' ? 'disabled' : 'available',
           occupant: null,
           guestOccupant: null,
           guestSessionStartTime: null,
           guestBreakEndTime: null,
           guestReported: false,
           guestReportEndTime: null,
           guestReportIssuedAt: null,
           guestReportVerifiedAt: null,
           pendingOccupant: null,
           pendingDeskRole: null,
           pendingDeskDeadline: null,
           breakEndTime: null,
           reportEndTime: null,
           reportIssuedAt: null,
           reportVerifiedAt: null,
           sessionStartTime: null
         }));

         const resetUsersSafety = usersAtSafety.map(u => ({
           ...u,
           activeDeskId: null,
           activeDeskRole: null,
           pendingDeskId: null,
           pendingDeskDeadline: null,
           strikes: 0,
           violationsResetDate: todayKey,
           lastActiveTime: currentTime
         }));

         desksRef.current = resetDesksSafety;
         usersRef.current = resetUsersSafety;
         setDesks(resetDesksSafety);
         setUsers(resetUsersSafety);

         try {
           localStorage.setItem('sgm_desks', JSON.stringify(resetDesksSafety));
           localStorage.setItem('sgm_users', JSON.stringify(resetUsersSafety));
         } catch (e) {
           console.warn(`${safetyTimeLabel} güvenlik temizliği localStorage yazma uyarısı:`, e);
         }

         setSelectedDeskId(null); setDeskSelectionDeadline(null);
         setScannerConfig({ isOpen: false, mode: null, title: '' });

         addLog(
           'IHLAL_DINAMIK_GUVENLIK_KONTROL_LOGU',
           activeDesksAtSafety.length > 0 || usersWithViolationsAtSafety.length > 0
             ? `${safetyTimeLabel} ikinci güvenlik kontrolü tamamlandı. ${activeDesksAtSafety.length} aktif/rezerve masa temizlendi; ${usersWithViolationsAtSafety.length} kullanıcının günlük ihlali arşivlenip sıfırlandı.`
             : `${safetyTimeLabel} ikinci güvenlik kontrolü tamamlandı. Sistemde açık masa, bekleyen rezervasyon veya sıfırlanmamış günlük ihlal bulunmadı.`,
           null,
           null,
           false,
           null,
           {
             activeDeskCount: activeDesksAtSafety.length,
             violationUserCount: usersWithViolationsAtSafety.length,
             closeTime: settings.closeTime,
             safetyTime: safetyTimeLabel,
             checkedAt: currentTime
           }
         );

         // Aşağıdaki ortak sıfırlama bloğu aynı turda güvenli şekilde çalışabilir.
         needSafetyReset2300 = true;

         // İşaret en son yazılır.
         try {
           localStorage.setItem(safetyMarkerKey, todayStr);
         } catch (e) {
           console.warn(`${safetyTimeLabel} güvenlik kontrol işareti yazılamadı:`, e);
         }
      }


      // Döngü içi state çakışmasını engellemek için mevcut değerleri Ref'ten okuyoruz
      const restrictedIds = new Set((usersRef.current || []).filter(u => u.blocked || isRestricted(u, currentTime)).map(u => u.id));
      const restrictedDeskIds = new Set((desksRef.current || []).filter(d => restrictedIds.has(d.occupant) || restrictedIds.has(d.pendingOccupant)).map(d => d.id));
      if ((!db || adminAuthorized) && restrictedDeskIds.size) {
        (desksRef.current || []).filter(desk => restrictedDeskIds.has(desk.id)).forEach(desk => {
          const userId = desk.occupant || desk.pendingOccupant;
          addLog('HESAP_KISITI_MASA_BOSALTILDI', `Masa ${desk.id}, kullanıcı hesabının kısıtlanması nedeniyle boşaltıldı.`, desk.id, userId, false, null,
            { eventId: `restricted-${desk.id}-${userId}-${desk.sessionStartTime || desk.pendingDeskDeadline || getLocalDayKey()}` });
        });
        const released = (desksRef.current || []).map(d => restrictedDeskIds.has(d.id) ? {...d, status: d.status === 'disabled' ? 'disabled' : 'available', occupant: null, ownerDeviceId: null, guestOccupant: null, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null, breakEndTime: null, reportEndTime: null, sessionStartTime: null} : d);
        desksRef.current = released; setDesks(released);
        const releasedUsers = (usersRef.current || []).map(u => restrictedIds.has(u.id) ? {...u, activeDeskId: null, activeDeskRole: null, pendingDeskId: null, pendingDeskDeadline: null} : u);
        usersRef.current = releasedUsers; setUsers(releasedUsers);
      }
      const currentDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
      let desksChanged = false;
      let usersToUpdate = []; // Ihlal alacak kullanici ID'leri
      const expiredDeskReservations = [];

      const newDesks = currentDesks.map(desk => {
        if (db && fbUser && (
          desk.pendingOccupant && Number(desk.pendingDeskDeadline) > 0 && currentTime >= Number(desk.pendingDeskDeadline) ||
          desk.status === 'on_break' && Number(desk.breakEndTime) > 0 && currentTime >= Number(desk.breakEndTime) ||
          desk.status === 'reported' && Number(desk.reportEndTime) > 0 && currentTime >= Number(desk.reportEndTime)
        )) {
          settleCloudExpiry(desk.id);
          return desk;
        }

        // 5 dakikalık QR rezervasyonu dolduysa masa/konuk kontenjanını yeniden seçilebilir yap.
        if (desk.pendingOccupant && desk.pendingDeskDeadline && currentTime >= Number(desk.pendingDeskDeadline)) {
          desksChanged = true;
          expiredDeskReservations.push({ deskId: desk.id, userId: desk.pendingOccupant, role: desk.pendingDeskRole || 'owner' });
          return { ...desk, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null };
        }

        if (desk.status === 'on_break' && desk.breakEndTime && currentTime >= desk.breakEndTime) {
          desksChanged = true;
          const deskUser = (Array.isArray(usersRef.current) ? usersRef.current : []).find(u => u.id === desk.occupant);
          const currentStrikes = Number.isFinite(Number(deskUser?.strikes)) ? Number(deskUser.strikes) : 0;
          const strikeLimit = 1; // İlk ihlalde masa otomatik boşaltılır
          const newStrikes = currentStrikes + 1;
          const shouldReleaseDesk = true; // İlk ihlalde masa boşaltılır.

          usersToUpdate.push({ id: desk.occupant, type: 'break_timeout', deskId: desk.id, newStrikes, shouldReleaseDesk });

          return shouldReleaseDesk
            ? { ...desk, status: 'available', occupant: null, ownerDeviceId: null, guestOccupant: null, pendingOccupant: null, pendingDeskDeadline: null, breakEndTime: null, reportEndTime: null, reportIssuedAt: null, reportVerifiedAt: null, sessionStartTime: null }
            : { ...desk, status: 'occupied', breakEndTime: null, reportEndTime: null };
        }
        
        if (desk.status === 'reported' && desk.reportEndTime && currentTime >= desk.reportEndTime) {
          desksChanged = true;

          // QR ile doğrulanan aynı ihbar, gecikmiş bir state/Firestore snapshot'ı yüzünden
          // tekrar "reported" görünse bile ihlal üretmesin.
          const reportWasAlreadyVerified = !!(
            desk.reportIssuedAt &&
            desk.reportVerifiedAt &&
            Number(desk.reportVerifiedAt) >= Number(desk.reportIssuedAt)
          );

          if (reportWasAlreadyVerified) {
            return { ...desk, status: 'occupied', reportEndTime: null, reportIssuedAt: null };
          }

          const deskUser = (Array.isArray(usersRef.current) ? usersRef.current : []).find(u => u.id === desk.occupant);
          const currentStrikes = Number.isFinite(Number(deskUser?.strikes)) ? Number(deskUser.strikes) : 0;
          const strikeLimit = 1; // İlk ihlalde masa otomatik boşaltılır
          const newStrikes = currentStrikes + 1;
          const shouldReleaseDesk = true; // İlk ihlalde masa boşaltılır.

          usersToUpdate.push({ id: desk.occupant, type: 'report_timeout', deskId: desk.id, newStrikes, shouldReleaseDesk });

          return shouldReleaseDesk
            ? { ...desk, status: 'available', occupant: null, ownerDeviceId: null, guestOccupant: null, pendingOccupant: null, pendingDeskDeadline: null, breakEndTime: null, reportEndTime: null, reportIssuedAt: null, sessionStartTime: null }
            : { ...desk, status: 'occupied', reportEndTime: null, reportIssuedAt: null };
        }

        // Misafir mola süresi dolduysa misafir kendi ihlalini alır; ana kullanıcının masa durumu değişmez.
        if (desk.guestOccupant && desk.guestBreakEndTime && currentTime >= desk.guestBreakEndTime) {
          desksChanged = true;
          const guestUser = (Array.isArray(usersRef.current) ? usersRef.current : []).find(u => u.id === desk.guestOccupant);
          const currentStrikes = Number.isFinite(Number(guestUser?.strikes)) ? Number(guestUser.strikes) : 0;
          const newStrikes = currentStrikes + 1;
          const shouldReleaseDesk = newStrikes >= 2;
          usersToUpdate.push({ id: desk.guestOccupant, type: 'guest_break_timeout', deskId: desk.id, newStrikes, shouldReleaseDesk, isGuest: true });
          return { ...desk, guestBreakEndTime: null, ...(shouldReleaseDesk ? { guestOccupant: null, guestSessionStartTime: null, guestReported: false, guestReportEndTime: null } : {}) };
        }

        // Misafir ihbar doğrulama süresi dolduysa ihlal yalnızca misafire uygulanır.
        if (desk.guestOccupant && desk.guestReported && desk.guestReportEndTime && currentTime >= desk.guestReportEndTime) {
          desksChanged = true;

          const guestReportWasAlreadyVerified = !!(
            desk.guestReportIssuedAt &&
            desk.guestReportVerifiedAt &&
            Number(desk.guestReportVerifiedAt) >= Number(desk.guestReportIssuedAt)
          );

          if (guestReportWasAlreadyVerified) {
            return { ...desk, guestReported: false, guestReportEndTime: null, guestReportIssuedAt: null };
          }

          const guestUser = (Array.isArray(usersRef.current) ? usersRef.current : []).find(u => u.id === desk.guestOccupant);
          const currentStrikes = Number.isFinite(Number(guestUser?.strikes)) ? Number(guestUser.strikes) : 0;
          const newStrikes = currentStrikes + 1;
          const shouldReleaseDesk = newStrikes >= 2;
          usersToUpdate.push({ id: desk.guestOccupant, type: 'guest_report_timeout', deskId: desk.id, newStrikes, shouldReleaseDesk, isGuest: true });
          return { ...desk, guestReported: false, guestReportEndTime: null, guestReportIssuedAt: null, ...(shouldReleaseDesk ? { guestOccupant: null, guestSessionStartTime: null, guestBreakEndTime: null } : {}) };
        }

        return desk;
      });

      // EĞER SÜRESİ DOLAN VARSA YA DA SIFIRLAMA GELDİYSE UPDATE ET (State nesting YOK!)
      if (needDeskReset || needSafetyReset2300) {
         // Kapanışta bütün masa durumlarını temizle; disabled masalar kapalı kalmaya devam eder.
         // Aynı temizleme 23:00 güvenlik kontrolünde de yedek olarak tekrar uygulanabilir.
         setDesks(currentDesks.map(d => ({ ...d, status: d.status === 'disabled' ? 'disabled' : 'available', occupant: null, guestOccupant: null, guestSessionStartTime: null, guestBreakEndTime: null, guestReported: false, guestReportEndTime: null, guestReportIssuedAt: null, guestReportVerifiedAt: null, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null, breakEndTime: null, reportEndTime: null, sessionStartTime: null })));

         // Günlük ihlal sayaçlarını 22:00'de sıfırla.
         // 23:00 güvenlik kontrolü devreye girdiyse sıfırlama ikinci kez güvenli şekilde uygulanır.
         // Kalıcı violationRecords listesine dokunulmaz; gün içinde addLog ile eklenen ihlal geçmişi korunur.
         // Ayrıca kapanış/güvenlik kontrolünden hemen önce kalan günlük ihlaller IHLAL_* arşiv logları ile kalıcı kayda alınır.
         setUsers(prev => Array.isArray(prev) ? prev.map(u => ({
           ...u,
           activeDeskId: null,
           activeDeskRole: null,
           pendingDeskId: null,
           pendingDeskDeadline: null,
           strikes: 0,
           violationsResetDate: todayKey,
           lastActiveTime: currentTime
         })) : []);

         setSelectedDeskId(null); setDeskSelectionDeadline(null);
         setScannerConfig({ isOpen: false, mode: null, title: '' });
      } else {
         if (desksChanged) {
            setDesks(newDesks);
         }

         // Öğrenci ekranı kapalı olsa bile yönetici paneli açıkken süresi dolan 5 dk rezervasyonları kayıtlara geçir.
         if (view === 'admin_dash' && expiredDeskReservations.length > 0) {
            expiredDeskReservations.forEach(item => {
              addLog(
                'MASA_REZERVASYON_SURE_DOLDU',
                `Masa ${item.deskId} için 5 dakikalık rezervasyon süresi doldu; QR doğrulaması yapılmadığı için rezervasyon otomatik iptal edildi.`,
                item.deskId,
                item.userId,
                false,
                null,
                { reservationRole: item.role, reservationExpiredAt: currentTime }
              );
            });
         }
         
         if (usersToUpdate.length > 0 || needUserReset) {
            setUsers(prevUsers => {
               if(!Array.isArray(prevUsers)) return [];
               return prevUsers.map(u => {
                  if (needUserReset) {
                     return {
                       ...u,
                       breaks: { short: settings.shortBreakCount, long: settings.longBreakCount },
                       breaksResetDate: todayKey,
                       violationsResetDate: todayKey,
                       strikes: 0,
                       // Günlük giriş kodu doğrulaması yalnızca doğrulandığı gün geçerlidir.
                       // Yeni güne ait olmayan eski doğrulama kaydını temizle; öğrenci ertesi gün kodu yeniden girsin.
                       dailyAccessVerifiedDate: u.dailyAccessVerifiedDate === todayKey ? u.dailyAccessVerifiedDate : ''
                     };
                  }
                  
                  const updateInfo = usersToUpdate.find(update => update.id === u.id);
                  if (updateInfo) {
                     const safeCurrentStrikes = Number.isFinite(Number(u.strikes)) ? Number(u.strikes) : 0;
                     const newStrikes = Number.isFinite(Number(updateInfo.newStrikes)) ? Number(updateInfo.newStrikes) : safeCurrentStrikes + 1;

                     // Log ve bildirim tetiklemeleri (state dışı yan etkiler)
                     if (updateInfo.type === 'guest_break_timeout') {
                         addLog('IHLAL_MISAFIR', `Masa ${updateInfo.deskId} misafir kullanıcısı mola süresini aştığı için ihlal aldı. Toplam ihlal: ${newStrikes}`, updateInfo.deskId, u.id);
                         if (true) ;
                     } else if (updateInfo.type === 'guest_report_timeout') {
                         addLog('IHLAL_MISAFIR', `Masa ${updateInfo.deskId} misafir kullanıcısı ihbar sonrası QR doğrulaması yapmadığı için ihlal aldı. Toplam ihlal: ${newStrikes}`, updateInfo.deskId, u.id);
                         if (true) ;
                     } else if (updateInfo.type === 'break_timeout') {
                         addLog('IHLAL', `Masa ${updateInfo.deskId} mola süresi aşıldığı için ihlal aldı. Toplam ihlal: ${newStrikes}`, updateInfo.deskId, u.id);
                         if (true) {
                           ;
                         }
                     } else {
                         addLog('IHLAL', `Masa ${updateInfo.deskId} boş bırakıldığı için ihlal aldı. Toplam ihlal: ${newStrikes}`, updateInfo.deskId, u.id);
                         if (true) {
                           ;
                         }
                     }

                     return {
                       ...u,
                       activeDeskId: updateInfo.shouldReleaseDesk ? null : u.activeDeskId,
                       activeDeskRole: updateInfo.shouldReleaseDesk ? null : u.activeDeskRole,
                       strikes: newStrikes,
                       ...applyViolationPolicy(u, updateInfo.deskId, currentTime),
                       // Mola süresi aşılmış olsa bile masa korunuyorsa yeni mola için 30 dk çalışma yeniden başlar.
                       lastActiveTime: (!updateInfo.shouldReleaseDesk && (updateInfo.type === 'break_timeout' || updateInfo.type === 'guest_break_timeout'))
                         ? currentTime
                         : u.lastActiveTime
                     };
                  }
                  return u;
               });
            });

            // Sadece bu cihazda geçerli kullanıcı düşürüldüyse bildirim at
            const myUpdate = usersToUpdate.find(u => currentUser && u.id === currentUser.id);
            if (myUpdate) {
                if (myUpdate.shouldReleaseDesk) {
                    sendNotification("İhlal: Masanız Boşaltıldı", `İhlal sayınız ${myUpdate.newStrikes} oldu. Masa ${myUpdate.deskId} sistem tarafından otomatik boşaltıldı.`);
                    showMessage("Masanız Otomatik Boşaltıldı", `İhlal nedeniyle Masa ${myUpdate.deskId} boşaltıldı. Bu masayı bugün tekrar alamazsınız. Son 7 günde ikinci ihlalde 7 günlük kısıtlama uygulanır.`, "danger");
                } else {
                    sendNotification("1. İhlal Kaydedildi", `İhlal sayınız ${myUpdate.newStrikes} oldu. İhlal oluştuğu anda masa otomatik boşaltılır.`);
                    showMessage("İhlal Kaydedildi", `İhlal sayınız ${myUpdate.newStrikes}/2 oldu. İhlal nedeniyle masa otomatik boşaltılır.`, "warning");
                }
            }
         }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [settings.strikeLimit, settings.openTime, settings.closeTime, settings.shortBreakCount, settings.longBreakCount, currentUser, isDataLoaded, adminAuthorized]);

  // AYNI CİHAZ = TEK MASA KURALI
  // Aynı tarayıcı/cihaz kimliği üzerinden başka bir kullanıcı adına aktif masa
  // veya süresi devam eden 5 dakikalık masa rezervasyonu varsa yeni masa seçilemez.
  const getDeviceDeskLock = (excludeUserId = null) => {
    const safeUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const currentTime = Date.now();

    const ownedDesk = (desksRef.current || []).find(d => d.ownerDeviceId === deviceId && d.occupant && d.occupant !== excludeUserId);
    if (ownedDesk) return { id: ownedDesk.occupant, activeDeskId: ownedDesk.id, name: safeUsers.find(u => u.id === ownedDesk.occupant)?.name };
    return safeUsers.find(u => {
      if (!u || u.id === excludeUserId) return false;
      if (!u.deviceId || u.deviceId !== deviceId) return false;

      const hasActiveDesk = !!u.activeDeskId;
      const hasActivePendingDesk = !!(
        u.pendingDeskId &&
        u.pendingDeskDeadline &&
        Number(u.pendingDeskDeadline) > currentTime
      );

      return hasActiveDesk || hasActivePendingDesk;
    }) || null;
  };

  // AYNI KULLANICI = TEK BEKLEYEN REZERVASYON KURALI
  // Kullanıcı kendi hesabıyla bir masa için 5 dakikalık QR rezervasyonu oluşturduysa
  // o rezervasyon bitmeden / iptal edilmeden farklı bir masa seçemez.
  // Bu kontrol, aynı cihaz kontrolünden bağımsızdır ve currentUser hariç tutulduğu için
  // oluşabilecek ikinci rezervasyon açığını kapatır.
  const getOwnPendingDeskLock = (userId, attemptedDeskId = null) => {
    const safeUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const currentTime = Date.now();
    const user = safeUsers.find(u => u && u.id === userId);
    if (!user) return null;

    const pendingDeskId = Number(user.pendingDeskId || 0);
    const pendingDeadline = Number(user.pendingDeskDeadline || 0);
    const hasValidPending = !!(pendingDeskId && pendingDeadline > currentTime);

    if (!hasValidPending) return null;
    if (attemptedDeskId != null && Number(attemptedDeskId) === pendingDeskId) return null;

    return { ...user, pendingDeskId, pendingDeskDeadline: pendingDeadline };
  };

  const requireStudentAction = (action, { deskClaim = false } = {}) => {
    const user = (usersRef.current || []).find(u => u.id === currentUser?.id);
    if (!user || user.blocked || isRestricted(user)) {
      setScannerConfig({ isOpen: false, mode: null, title: '' });
      addLog('KISITLI_ISLEM_ENGELLENDI', `${action} işlemi hesap kısıtı nedeniyle engellendi.`, null, user?.id || currentUser?.id || null);
      showMessage('Hesabınız Kısıtlı', 'Kısıtlı hesaplar masa seçemez, boş masa ihbarı ve dilek / şikayet gönderemez. Gerekli kontroller için kütüphane sorumlusu ile iletişime geçin.', 'warning');
      return null;
    }
    if (deskClaim && deskWaitRemaining(user) > 0) {
      setScannerConfig({ isOpen: false, mode: null, title: '' });
      addLog('MASA_BEKLEME_ENGELLENDI', `${action} işlemi 30 dakikalık bekleme süresi nedeniyle engellendi.`, null, user.id);
      showMessage('Masa Alma Bekleme Süresi', `Masanızı bıraktıktan sonra 30 dakika beklemelisiniz. Kalan süre: ${formatTime(deskWaitRemaining(user))}. Sistem hatası yaşadıysanız yönetici masa atayabilir.`, 'warning');
      return null;
    }
    return user;
  };
  const openStudentFeedback = () => {
    const user = requireStudentAction('Dilek / Şikayet');
    if (!user) return;
    setFeedbackForm({ name: user.name, identityNo: user.specialCode, type: '', message: '' });
    setFeedbackStep(2); setView('feedback');
    addLog('GERIBILDIRIM_ACILDI', 'Dilek / Şikayet ekranı açıldı.', null, user.id);
  };

  // Öğrenci masasını QR doğrulamasından önce seçer. Seçim 5 dakika geçerlidir.
  const selectDeskForClaim = async (deskIdValue) => {
    if (!requireStudentAction('Masa seçimi', { deskClaim: true })) return;
    if (!checkLibraryOpen()) {
      return showMessage("Kütüphane Kapalı", `Mesai saatleri (${settings.openTime} - ${settings.closeTime}) dışında masa seçilemez.`, "warning");
    }

    const deskId = Number(deskIdValue);
    const safeDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
    const desk = safeDesks.find(d => d.id === deskId);
    if (!desk) return showMessage("Hata", "Seçilen masa bulunamadı.", "danger");
    if (desk.status === 'disabled') return showMessage("Uyarı", "Bu masa kullanıma kapatılmıştır.", "warning");

    const safeUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const reservationOwner = desk.pendingOccupant ? safeUsers.find(u => u.id === desk.pendingOccupant) : null;
    const reservationDeadline = Number(desk.pendingDeskDeadline || 0);
    const reservationActive = !!(desk.pendingOccupant && reservationDeadline > Date.now() && reservationOwner &&
      Number(reservationOwner.pendingDeskId) === deskId &&
      Number(reservationOwner.pendingDeskDeadline || 0) === reservationDeadline);

    if (reservationActive && desk.pendingOccupant !== currentUser.id) {
      return showMessage("Masa Rezerve", `Masa ${deskId} başka bir öğrenci tarafından seçildi ve QR doğrulaması bekleniyor. Lütfen başka bir masa seçin.`, "warning");
    }

    const freshUser = safeUsers.find(u => u.id === currentUser.id);
    if (!freshUser || isRestricted(freshUser) || freshUser.blocked) return showMessage('Erişim Kısıtlı', 'Aktif ve onaylanmış hesap gereklidir.', 'danger');
    if (lostDeskToday(freshUser, deskId)) {
      ;
      return showMessage('Masa Kısıtı', 'İhlal nedeniyle kaybettiğiniz masayı bugün tekrar alamazsınız.', 'warning');
    }
    if (desk.status !== 'available') return showMessage('Masa Dolu', 'Her masa tek kişiliktir. Lütfen boş bir masa seçin.', 'warning');

    if (freshUser?.activeDeskId) {
      return showMessage("İşlem Reddedildi", "Zaten aktif bir masanız bulunuyor. Önce mevcut masanızı bırakmalısınız.", "danger");
    }

    // SERT KURAL: Aynı kullanıcı aynı anda yalnızca 1 adet bekleyen masa rezervasyonuna sahip olabilir.
    // İlk rezervasyonun 5 dakikalık süresi devam ederken farklı masa seçmeye kesinlikle izin verilmez.
    const ownPendingDeskLock = getOwnPendingDeskLock(currentUser.id, deskId);
    if (ownPendingDeskLock) {
      const lockedDeskId = Number(ownPendingDeskLock.pendingDeskId);
      addLog(
        'AYNI_KULLANICI_IKINCI_REZERVASYON_ENGELLENDI',
        `Aynı kullanıcı için ikinci masa rezervasyonu engellendi. Kullanıcının Masa ${lockedDeskId} için aktif QR rezervasyonu bulunurken Masa ${deskId} seçilmeye çalışıldı.`,
        lockedDeskId || null,
        currentUser.id,
        false,
        null,
        { deviceId, lockedDeskId, attemptedDeskId: deskId, pendingDeadline: ownPendingDeskLock.pendingDeskDeadline, strictRule: true }
      );
      return showMessage(
        "Aktif Rezervasyonunuz Var",
        `Masa ${lockedDeskId} için devam eden bir rezervasyonunuz bulunuyor. Aynı anda ikinci masa seçemezsiniz. Önce mevcut rezervasyonu tamamlayın, iptal edin veya süresinin dolmasını bekleyin.`,
        "danger"
      );
    }

    // Aynı cihazdan farklı hesaplarla ikinci masa alınmasını engelle.
    const deviceDeskLock = getDeviceDeskLock(currentUser.id);
    if (deviceDeskLock) {
      const lockedDeskId = deviceDeskLock.activeDeskId || deviceDeskLock.pendingDeskId;
      const lockType = deviceDeskLock.activeDeskId ? 'aktif olarak kullanılıyor' : 'QR doğrulaması için rezerve edilmiş durumda';
      addLog('AYNI_CIHAZ_IKINCI_MASA_ENGELLENDI', `Aynı cihaz üzerinden ikinci masa seçimi engellendi. Bu cihaz Masa ${lockedDeskId} için ${deviceDeskLock.name || 'başka bir kullanıcı'} adına ${lockType}.`, lockedDeskId || null, currentUser.id, false, null, { deviceId, lockedUserId: deviceDeskLock.id, attemptedDeskId: deskId, strictRule: true, rule: 'ONE_DEVICE_ONE_DESK' });
      return showMessage("Bu Cihazda Zaten Masa Var", `Aynı cihaz üzerinden yalnızca 1 masa alınabilir. Bu cihazda Masa ${lockedDeskId} ${lockType}. Yeni masa almak için önce mevcut masa veya rezervasyon sonlandırılmalıdır.`, "danger");
    }
    if (freshUser && freshUser.strikes >= settings.strikeLimit) {
      return showMessage("Erişim Engellendi", "Günlük ihlal limitini doldurduğunuz için bugün masa seçemezsiniz.", "danger");
    }

    // Her masa tek kişiliktir; misafir oturumu kaldırılmıştır.
    if (desk.status !== 'available') {
      return showMessage("Masa Uygun Değil", "Bu masa dolu. Misafir seçeneği kaldırıldığı için yalnızca boş masalar seçilebilir.", "warning");
    }

    let reserved = null;
    if (db) {
      if (!fbUser || !granularSyncReadyRef.current || !navigator.onLine || Date.now() < quotaBackoffUntilRef.current) return showMessage('Bağlantı Bekleniyor', 'Masa seçimi için sunucu bağlantısı gerekli. Lütfen bağlantı/kota düzeldikten sonra tekrar deneyin.', 'warning');
      if (deskActionInFlightRef.current) return;
      deskActionInFlightRef.current = true;
      try {
        reserved = await runStudentDeskAction('reserve', { deskId, deviceId });
        applyCloudRows(reserved);
      }
      catch (error) { handleFirestoreQuotaError(error); return showMessage('Masa Seçilemedi', error.message, 'warning'); }
      finally { deskActionInFlightRef.current = false; }
    }
    const deadline = reserved?.deadline || Date.now() + (5 * 60 * 1000);
    const pendingRole = 'owner';
    setSelectedDeskId(deskId);
    setDeskSelectionDeadline(deadline);
    const nextDesksAfterReservation = (Array.isArray(desksRef.current) ? desksRef.current : []).map(d => d.id === deskId ? {
      ...d, pendingOccupant: currentUser.id, pendingDeskRole: pendingRole, pendingDeskDeadline: deadline
    } : d);
    const nextUsersAfterReservation = (Array.isArray(usersRef.current) ? usersRef.current : []).map(u =>
      u.id === currentUser.id ? { ...u, pendingDeskId: deskId, pendingDeskDeadline: deadline } : u
    );
    desksRef.current = nextDesksAfterReservation;
    usersRef.current = nextUsersAfterReservation;
    criticalDeskMutationRef.current = true;
    pendingReservationGuardRef.current = { userId: currentUser.id, deskId, role: pendingRole, deadline, deviceId, createdAt: Date.now() };
    setDesks(nextDesksAfterReservation);
    setUsers(nextUsersAfterReservation);
    setCurrentUser(prev => prev ? { ...prev, pendingDeskId: deskId, pendingDeskDeadline: deadline } : prev);
    addLog(
      'MASA_REZERVE_EDILDI',
      `Masa ${deskId} rezerve edildi. Öğrencinin masaya geçip QR kodunu doğrulaması için 5 dakikalık süre başlatıldı.`,
      deskId,
      currentUser.id,
      false,
      null,
      { reservationRole: pendingRole, reservationDeadline: deadline }
    );
    addLog('MASA_SECILDI', `Masa ${deskId} seçildi. QR doğrulaması için 5 dakikalık süre başlatıldı.`, deskId, currentUser.id);
    showMessage("Masa Seçildi", `Masa ${deskId} seçildi. Bu masanın QR kodunu 5 dakika içinde okutmalısınız.`, "success");
  };

  const cancelDeskSelection = async (reason = 'Öğrenci masa seçimini iptal etti.') => {
    if (!currentUser) return;
    const oldDeskId = selectedDeskId;
    if (oldDeskId && db) {
      try {
        const result = await runStudentDeskAction('cancel', { deskId: oldDeskId });
        if (result) applyCloudRows(result);
      } catch (error) {
        handleFirestoreQuotaError(error);
        showMessage('Rezervasyon İptal Edilemedi', error.message, 'warning');
        return;
      }
    }
    if (pendingReservationGuardRef.current?.userId === currentUser.id) pendingReservationGuardRef.current = null;
    criticalDeskMutationRef.current = true;
    setSelectedDeskId(null);
    setDeskSelectionDeadline(null);
    if (oldDeskId) {
      setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === oldDeskId && d.pendingOccupant === currentUser.id ? {
        ...d, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null
      } : d) : []);
    }
    setUsers(prev => Array.isArray(prev) ? prev.map(u => u.id === currentUser.id ? { ...u, pendingDeskId: null, pendingDeskDeadline: null } : u) : []);
    setCurrentUser(prev => prev ? { ...prev, pendingDeskId: null, pendingDeskDeadline: null } : prev);
    if (oldDeskId) addLog('MASA_SECIM_IPTAL', reason, oldDeskId, currentUser.id);
  };

  useEffect(() => {
    if (!currentUser || !selectedDeskId || !deskSelectionDeadline) return;
    if (now < deskSelectionDeadline) return;

    const expiredDeskId = selectedDeskId;
    if (pendingReservationGuardRef.current?.userId === currentUser.id) pendingReservationGuardRef.current = null;
    criticalDeskMutationRef.current = true;
    setSelectedDeskId(null);
    setDeskSelectionDeadline(null);
    setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === expiredDeskId && d.pendingOccupant === currentUser.id ? {
      ...d, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null
    } : d) : []);
    setUsers(prev => Array.isArray(prev) ? prev.map(u => u.id === currentUser.id ? { ...u, pendingDeskId: null, pendingDeskDeadline: null } : u) : []);
    setCurrentUser(prev => prev ? { ...prev, pendingDeskId: null, pendingDeskDeadline: null } : prev);
    addLog('MASA_SECIM_SURE_DOLDU', `Masa ${expiredDeskId} seçimi QR kod 5 dakika içinde okutulmadığı için iptal edildi.`, expiredDeskId, currentUser.id);
    addLog('MASA_REZERVASYON_IPTAL', `Masa ${expiredDeskId} rezervasyonu 5 dakikalık süre dolduğu için otomatik iptal edildi; öğrenci QR doğrulaması yapmadı.`, expiredDeskId, currentUser.id);
    setScannerConfig({ isOpen: false, mode: null, title: '' });
    showMessage("Süre Doldu", `Masa ${expiredDeskId} için 5 dakikalık QR okutma süreniz doldu. Lütfen yeniden masa seçin.`, "warning");
  }, [now, currentUser?.id, selectedDeskId, deskSelectionDeadline]);

  const prepareNewStudentRegistration = () => {
    if (registrationInFlightRef.current) return;
    // Yalnızca bu cihazın kayıt ekranı temizlenir; önceki hesap sunucuda korunur.
    localStorage.removeItem('sgm_registration_account');
    ['sgm_registration_token', 'sgm_registration_credentials', 'sgm_registration_form_url', 'sgm_registration_form_opened'].forEach(key => sessionStorage.removeItem(key));
    sessionStorage.setItem('sgm_registration_new_person', '1');
    setRegistrationPending(''); setRegistrationResult(null); setRegistrationFormUrl('');
    setRegistrationFormOpened(false); setRegistrationError('');
    setRegistrationAccepted(false); setRegistrationRulesOpen(true); setShowRules(true);
  };

  const startRegistration = async () => {
    if (!registrationAccepted || registrationInFlightRef.current) return;
    registrationInFlightRef.current = true;
    setRegistrationBusy(true); setRegistrationError('');
    try {
      if (!isDataLoaded) throw new Error('Sistem verileri yüklenene kadar bekleyin.');
      if (db && auth) {
        await ensureTabAuthPersistence();
        await auth.authStateReady();
      }
      const newPerson = sessionStorage.getItem('sgm_registration_new_person') === '1';
      // Hesap oluşturma Google Form bağlantısından bağımsızdır. Link yalnızca Devam Et adımında kontrol edilir.
      // Aynı cihazda kayıt bilgileri duruyorsa yeni hesap yerine mevcut kısıtlı hesabı göster.
      const saved = (() => { try { return JSON.parse(localStorage.getItem('sgm_registration_account') || 'null'); } catch { return null; } })();
      let registrationAuthUser = auth?.currentUser || fbUser;
      let user = newPerson ? null : (usersRef.current || []).find(u => u.id === saved?.userId);
      if (db && user && String(user.id) !== String(registrationAuthUser?.uid)) user = null;
      if (user && (isRecordDeleted('users', user.id) || serverDeletedUserIdsRef.current.has(String(user.id)))) user = null;
      if (!user && saved?.userId) {
        // Silinen hesabın veya önceki oturumun cihazda kalan kaydı yeni kaydı engellemez.
        localStorage.removeItem('sgm_registration_account');
        ['sgm_registration_token', 'sgm_registration_credentials', 'sgm_registration_form_url', 'sgm_registration_form_opened'].forEach(key => sessionStorage.removeItem(key));
        setRegistrationPending(''); setRegistrationResult(null);
        setRegistrationFormUrl(''); setRegistrationFormOpened(false);
        const oldSession = (() => { try { return JSON.parse(sessionStorage.getItem('sgm_student_session') || 'null'); } catch { return null; } })();
        if (oldSession?.userId === saved.userId) sessionStorage.removeItem('sgm_student_session');
      }
      if (db && !user) {
        if (!auth) throw new Error('Firebase oturumu başlatılamadı.');
        // Silinmiş öğrenci tokenı kayıt API'sine gönderilmez. Doğrulanmış anonim
        // oturum oluşturulur; istemci yeni hesabın kimliğini kendisi seçmez.
        if (registrationAuthUser && (newPerson || !registrationAuthUser.isAnonymous ||
            serverDeletedUserIdsRef.current.has(String(registrationAuthUser.uid)) ||
            isRecordDeleted('users', registrationAuthUser.uid))) {
          await signOut(auth);
          registrationAuthUser = null;
          setCurrentUser(null); setSelectedDeskId(null); setDeskSelectionDeadline(null);
        }
        if (!registrationAuthUser) registrationAuthUser = (await signInTabAnonymously()).user;
        // İstek kaybolursa tekrar aynı yeni oturum kullanılır; ikinci hesap açılmaz.
        sessionStorage.removeItem('sgm_registration_new_person');
        verifiedAdminUidRef.current = null;
        setFbUser(registrationAuthUser);
      }
      // Aynı doğrulanmış anonim oturumda eksik yerel hesap, kayıt API'sinden
      // yeniden getirilir. API mevcut hesabı döndürür; kod/şifre değiştirilmez.
      if (!user) {
        const token = crypto.randomUUID ? crypto.randomUUID() : 'REG-' + Date.now() + '-' + generateId();
        const createUser = rows => ({
          id: 'REG-' + token,
          name: 'Yeni Kayıt',
          identityNo: createEightDigitCode(new Set(rows.map(u => u.identityNo))),
          specialCode: createEightDigitCode(new Set(rows.map(u => u.specialCode))),
          pin: createEightDigitCode(new Set(rows.map(u => u.pin))),
          registrationSession: token, registrationFormStatus: 'manual_review',
          pendingApproval: true, restrictedUntil: 0,
          restrictionReason: 'Google Form kontrolü ve kütüphane sorumlusu onayı bekleniyor',
          activeDeskId: null, activeDeskRole: null, pendingDeskId: null, pendingDeskDeadline: null,
          breaks: { short: settings.shortBreakCount, long: settings.longBreakCount },
          strikes: 0, blocked: false, canReport: true, createdAt: Date.now()
        });
        if (db) {
          let response, payload;
          for (let attempt = 0; attempt < 2; attempt++) {
            // Aynı doğrulanmış anonim UID kullanılır; 401'de yetki atlanmaz.
            const tokenResult = await registrationAuthUser.getIdTokenResult(true);
            if (auth.currentUser?.uid !== registrationAuthUser.uid) throw new Error('Kayıt sırasında oturum değişti. Kayıt ekranından tekrar deneyin.');
            if (tokenResult.claims.firebase?.sign_in_provider !== 'anonymous') throw new Error('Anonim kayıt oturumu doğrulanamadı. Başka öğrenci için yeni kayıt düğmesini kullanın.');
            response = await fetch('/api/student-register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenResult.token}` },
              body: JSON.stringify({})
            });
            payload = await response.json().catch(() => null);
            if (response.status !== 401) break;
          }
          if (!response.ok || payload?.ok !== true || !payload?.user?.id || !payload?.credentials?.specialCode || !payload?.credentials?.pin) {
            throw new Error(payload?.message || `Kayıt servisi HTTP ${response.status} döndürdü.`);
          }
          if (String(payload.user.id) !== String(registrationAuthUser.uid)) {
            throw new Error('Kayıt sonucu doğrulanmış cihaz oturumuyla eşleşmiyor.');
          }
          user = { ...payload.user, ...payload.credentials };
          granularBaselineRef.current.users.set(String(user.id), user);
        } else {
          user = createUser(usersRef.current || []); user.name = `Yeni Kayıt • ${user.specialCode}`;
        }
        const next = [...(usersRef.current || []).filter(u => u.id !== user.id), user];
        usersRef.current = next; setUsers(next);
        localStorage.setItem('sgm_users', JSON.stringify(next));
        localStorage.setItem('sgm_registration_account', JSON.stringify({ userId: user.id }));
        addLog('KULLANICI_KAYIT', 'Kurallar onaylandı. GM Özel Kod ve şifre üretildi; hesap sorumlu onayına kadar kısıtlı.', null, user.id);
      } else {
        addLog('KAYIT_BILGILERI_GOSTERILDI', 'Mevcut kayıt bilgileri yeniden gösterildi; yeni hesap oluşturulmadı.', null, user.id);
      }
      const credentials = { specialCode: user.specialCode, pin: user.pin };
      sessionStorage.setItem('sgm_registration_token', user.registrationSession || user.id);
      sessionStorage.setItem('sgm_registration_credentials', JSON.stringify(credentials));
      sessionStorage.setItem('sgm_registration_form_url', normalizeRegistrationUrl(settingsRef.current.registrationFormUrl));
      setRegistrationPending(user.registrationSession || user.id);
      setRegistrationResult(credentials); setRegistrationFormUrl(normalizeRegistrationUrl(settingsRef.current.registrationFormUrl));
      sessionStorage.removeItem('sgm_registration_form_opened');
      setRegistrationFormOpened(false); setRegistrationRulesOpen(false); setShowRules(false);
    } catch (error) {
      setRegistrationError(error.message);
      addLog('KAYIT_HATA', 'Kullanıcı kaydı başlatılamadı: ' + error.message);
    } finally {
      registrationInFlightRef.current = false; setRegistrationBusy(false);
    }
  };

  const copyRegistrationValue = async (label, value) => {
    try {
      addLog('KAYIT_BILGI_KOPYALA', `${label} kopyalama istendi.`);
      await navigator.clipboard.writeText(String(value || ''));
      showMessage('Kopyalandı', `${label} panoya kopyalandı.`, 'success');
    } catch {
      showMessage('Kopyalanamadı', `${label}: ${value}`, 'warning');
    }
  };

  const refreshRegistrationFormUrl = async () => {
    let latest = settingsRef.current;
    if (db && fbUser) {
      try {
        // Açık sekmenin eski state'i yerine parçalı config belgesindeki güncel bağlantıyı oku.
        const snapshot = await getDoc(getLiveSettingsDoc());
        if (snapshot.exists()) latest = mergeRegistrationSettings(latest, snapshot.data() || {});
      } catch (error) {
        console.warn('Kayıt bağlantısı yenilenemedi; mevcut kayıt kullanılacak:', error);
      }
    }
    // Aynı cihazdaki YP kaydını, başka sekme ve sayfa yenilemesinden sonra da kullan.
    let cached = {};
    try { cached = JSON.parse(localStorage.getItem('sgm_settings') || '{}'); } catch {}
    latest = mergeRegistrationSettings(cached, latest);
    const url = normalizeRegistrationUrl(latest.registrationFormUrl);
    if (validRegistrationUrl(url)) {
      settingsRef.current = latest;
      setSettings(prev => mergeRegistrationSettings(prev, latest));
      setRegistrationFormUrl(url);
      try {
        sessionStorage.setItem('sgm_registration_form_url', url);
        localStorage.setItem('sgm_settings', JSON.stringify(latest));
      } catch {}
      return url;
    }
    // Eski kayıt ekranında tutulan geçerli bağlantı, tek kullanımlık yedek olabilir.
    const fallback = normalizeRegistrationUrl(registrationFormUrl || sessionStorage.getItem('sgm_registration_form_url'));
    return validRegistrationUrl(fallback) ? fallback : '';
  };
  const openRegistrationGoogleForm = async () => {
    if (registrationRedirectInFlightRef.current) return;
    registrationRedirectInFlightRef.current = true;
    setRegistrationRedirectBusy(true);
    try {
      const url = await refreshRegistrationFormUrl();
      if (!url) {
        return showMessage('Hesabınız Oluşturuldu', 'GM Özel Kod ve şifreniz hazır; hesabınız kısıtlı olarak korunuyor. Google Form bağlantısı bulunamadı. Kütüphane sorumlusundan YP → Kayıt / Google Form bölümündeki bağlantıyı kontrol etmesini isteyin.', 'warning');
      }
      // Aynı sekmede yönlendirme: açılır pencere engeli akışı durduramaz.
      // Google Form'a gitmeden önce kayıt bilgilerini ve yönlendirme durumunu koru.
      if (registrationResult) sessionStorage.setItem('sgm_registration_credentials', JSON.stringify(registrationResult));
      sessionStorage.setItem('sgm_registration_form_opened', '1');
      setRegistrationFormOpened(true);
      addLog('KAYIT_FORM_YONLENDIRME', 'Google Form bağlantısına yönlendirildi. Formun tamamlanması yönetici tarafından kontrol edilecek.', null, currentUser?.id || null);
      window.location.assign(url);
    } catch (error) {
      showMessage('Form Açılamadı', 'Hesabınız korunuyor. Google Form bağlantısı açılamadı; tekrar deneyin.', 'warning');
      addLog('KAYIT_FORM_YONLENDIRME_HATA', 'Google Form yönlendirmesi başarısız oldu.');
    } finally {
      registrationRedirectInFlightRef.current = false;
      setRegistrationRedirectBusy(false);
    }
  };
  const fillRegistrationLogin = () => {
    if (!registrationResult) return;
    setLoginIdentity(String(registrationResult.specialCode || ''));
    setLoginPin(String(registrationResult.pin || '')); setView('student_login');
    handleStudentLogin({ preventDefault() {}, target: {} }, registrationResult);
    addLog('KAYIT_GIRIS_HAZIRLANDI', 'GM Özel Kod ve şifre giriş alanlarına aktarıldı.');
  };

  const handleStudentLogin = async (e, credentials = null) => {
    e.preventDefault();
    
    if (!isDataLoaded) {
        return showMessage("Lütfen Bekleyin", "Sistem verileri senkronize ediliyor. İnternet bağlantınızı kontrol edip birkaç saniye sonra tekrar deneyin.", "warning");
    }

    if (!checkLibraryOpen()) {
        return showMessage("Kütüphane Kapalı", `Kütüphanemiz şu an kapalıdır. Çalışma saatleri: ${settings.openTime} - ${settings.closeTime} arasındadır.`, "warning");
    }

    const rawPhone = String(credentials?.specialCode || loginIdentity || e.target.identityNo?.value || '');
    if(!/^\d{8}$/.test(rawPhone) || !/^\d{8}$/.test(String(credentials?.pin || loginPin || e.target.pin?.value || ''))) return showMessage("Bilgileri Kontrol Edin","GM Özel Kod ve şifre 8 rakamdan oluşmalıdır.","warning");
    const rawPin = String(credentials?.pin || loginPin || e.target.pin?.value || '');
    
    try {
      const response = await fetch('/api/student-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialCode: rawPhone, pin: rawPin })
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 400) {
        addLog('OGRENCI_GIRIS_HATA', 'Başarısız öğrenci giriş denemesi.');
        return showMessage('Giriş Başarısız', 'GM Özel Kod veya şifre hatalı. Her ikisi de 8 rakam olmalıdır.', 'danger');
      }
      if (!response.ok || payload?.ok !== true || !payload?.token || !payload?.user?.id) {
        return showMessage('Giriş Hatası', payload?.message || `Öğrenci giriş servisi HTTP ${response.status} döndürdü. Bağlantıyı kontrol edip tekrar deneyin.`, 'danger');
      }
      if (!auth) throw new Error('Firebase ayarları bulunamadı.');
      const credential = await signInTabWithCustomToken(payload.token);
      const tokenResult = await credential.user.getIdTokenResult(true);
      if (tokenResult.claims.role !== 'student' || credential.user.uid !== payload.user.id) {
        await signOut(auth);
        await signInTabAnonymously();
        throw new Error('Öğrenci oturumu doğrulanamadı.');
      }
      const user = normalizeRemoteUsers([payload.user], settingsRef.current)[0];
      const safeUsers = [user];
      usersRef.current = safeUsers;
      setUsers(safeUsers);
      localStorage.setItem('sgm_users', JSON.stringify(safeUsers));
      granularBaselineRef.current.users.set(String(user.id), user);

    setFbUser(credential.user);
    // Kısıtlı kullanıcı da giriş yapar; işlem yetkileri güncel hesap kaydıyla kontrol edilir.
    const pendingIsValid = user.pendingDeskId && user.pendingDeskDeadline && Number(user.pendingDeskDeadline) > Date.now();
    const updatedUser = {
      ...user,
      deviceId: deviceId,
      pendingDeskId: pendingIsValid ? user.pendingDeskId : null,
      pendingDeskDeadline: pendingIsValid ? user.pendingDeskDeadline : null
    };
    usersRef.current = [updatedUser];
    setUsers([updatedUser]);
    sessionStorage.setItem('sgm_student_session', JSON.stringify({ userId: updatedUser.id }));
    setCurrentUser(updatedUser);
    setSelectedDeskId(pendingIsValid ? Number(user.pendingDeskId) : null);
    setDeskSelectionDeadline(pendingIsValid ? Number(user.pendingDeskDeadline) : null);

    setView('student_dash');
    addLog('ÖĞRENCİ_GİRİŞİ', `${updatedUser.name} sisteme giriş yaptı.`, updatedUser.activeDeskId || null, updatedUser.id);

    if (updatedUser.blocked || isRestricted(updatedUser)) {
      setTimeout(() => {
        showMessage(
          'Hesabınız Şu An Kısıtlı',
          'Kısıtınızı kaldırabilmeniz için kütüphane sorumlumuz ile iletişime geçebilirsiniz. Gerekli kontroller yapıldıktan sonra sorumlu tarafından hesabınız aktif edilecektir.',
          'warning'
        );
      }, 150);
    }

    setLoginIdentity('');
    setLoginPin('');
    } catch (error) {
      console.error('Öğrenci giriş hatası:', error);
      showMessage('Bağlantı Hatası', error.message || 'Öğrenci giriş servisine ulaşılamadı.', 'danger');
    }
  };

  const logoutStudent = async () => {
    addLog('OGRENCI_CIKIS', 'Kullanıcı kendi isteğiyle çıkış yaptı.', null, currentUser?.id);
    sessionStorage.removeItem('sgm_student_session');
    setCurrentUser(null);
    setView('role_select');
    setUsers([]);
    usersRef.current = [];
    localStorage.removeItem('sgm_users');
    // Çıkış kaydı mevcut öğrenci tokenı geçerliyken gönderilsin.
    await appendChainRef.current.catch(() => {});
    if (auth) {
      await signOut(auth);
      await signInTabAnonymously();
    }
  };



  const claimDesk = async (qrData) => {
    if (!requireStudentAction('QR ile masa alma', { deskClaim: true })) return;
    // Yönetici panelinden kısıt/onay kaldırılmışsa currentUser eski kalmış olabilir.
    // QR işleminde daima Firestore/users state'inden gelen EN GÜNCEL kullanıcıyı esas al.
    const latestClaimUser = (Array.isArray(usersRef.current) ? usersRef.current : [])
      .find(u => u.id === currentUser?.id) || currentUser;

    if (latestClaimUser?.pendingApproval) {
      setScannerConfig({isOpen: false, mode: null});
      return showMessage(
        "Hesabınız Kısıtlı",
        "Masa kullanabilmek için önce kütüphane sorumlumuz ile iletişime geçin. Gerekli kontroller yapılıp hesabınız onaylandıktan sonra kısıtınız kaldırılacaktır.",
        "warning"
      );
    }

    if (!checkLibraryOpen()) {
        setScannerConfig({isOpen: false, mode: null});
        return showMessage("Kütüphane Kapalı", `Mesai saatleri (${settings.openTime} - ${settings.closeTime}) dışında masa alınamaz.`, "warning");
    }

    const parts = qrData.split('-');
    if (parts.length < 2) {
        setScannerConfig({isOpen: false, mode: null});
        return showMessage("Hata", "Geçersiz QR Kod.", "danger");
    }
    const deskId = parseInt(parts[1]);

    const safeDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
    const desk = safeDesks.find(d => d.id === deskId);
    if (!desk) {
        setScannerConfig({isOpen: false, mode: null});
        return showMessage("Hata", "Masa bulunamadı.", "danger");
    }

    // Rezervasyonu çoklu kaynaktan doğrula. Firestore snapshot'ı kısa süreli geride kalsa bile
    // gerçek 5 dakikalık rezervasyon kaybolmaz.
    const reservationUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const reservationUser = reservationUsers.find(u => u.id === currentUser.id);
    const reservationGuard = pendingReservationGuardRef.current;
    const reservationNow = Date.now();

    const deskReservationValid = !!(
      desk.pendingOccupant === currentUser.id &&
      Number(desk.pendingDeskDeadline || 0) > reservationNow
    );
    const userReservationValid = !!(
      Number(reservationUser?.pendingDeskId || currentUser?.pendingDeskId || 0) === deskId &&
      Number(reservationUser?.pendingDeskDeadline || currentUser?.pendingDeskDeadline || 0) > reservationNow
    );
    const localReservationValid = !!(
      Number(selectedDeskId || 0) === deskId &&
      Number(deskSelectionDeadline || 0) > reservationNow
    );
    const guardReservationValid = !!(
      reservationGuard &&
      reservationGuard.userId === currentUser.id &&
      Number(reservationGuard.deskId) === deskId &&
      Number(reservationGuard.deadline || 0) > reservationNow
    );

    if (!(deskReservationValid || userReservationValid || localReservationValid || guardReservationValid)) {
      setScannerConfig({isOpen:false, mode:null});
      return showMessage("Rezervasyon Bulunamadı", `Masa ${deskId} için aktif rezervasyonunuz bulunmuyor. Lütfen masayı yeniden seçip kendi QR kodunu okutun.`, "warning");
    }

    const effectiveSelectedDeskId = Number(
      selectedDeskId || reservationUser?.pendingDeskId || currentUser?.pendingDeskId || reservationGuard?.deskId || 0
    );
    const effectiveDeskSelectionDeadline = Number(
      deskSelectionDeadline || reservationUser?.pendingDeskDeadline || currentUser?.pendingDeskDeadline || reservationGuard?.deadline || 0
    );

    if (!effectiveSelectedDeskId || !effectiveDeskSelectionDeadline) {
      setScannerConfig({isOpen: false, mode: null});
      return showMessage("Önce Masa Seçin", "QR kod okutmadan önce öğrenci panelinden kullanacağınız masayı seçmelisiniz.", "warning");
    }
    if (Date.now() > effectiveDeskSelectionDeadline) {
      setScannerConfig({isOpen: false, mode: null});
      cancelDeskSelection(`Masa ${effectiveSelectedDeskId} seçiminin 5 dakikalık QR süresi doldu.`);
      return showMessage("Süre Doldu", "5 dakikalık QR okutma süreniz doldu. Lütfen yeniden masa seçin.", "warning");
    }
    if (deskId !== effectiveSelectedDeskId) {
      setScannerConfig({isOpen: false, mode: null});
      return showMessage("Yanlış Masa QR Kodu", `Masa ${effectiveSelectedDeskId} seçtiniz. Lütfen yalnızca Masa ${effectiveSelectedDeskId} üzerindeki QR kodu okutun.`, "danger");
    }
    if (qrData !== desk.qrCode) {
        setScannerConfig({isOpen: false, mode: null});
        return showMessage("Geçersiz QR Kod", `Okutulan QR kod Masa ${deskId} için güncel sistem QR koduyla eşleşmiyor.`, "danger");
    }
    
    if (desk.status === 'disabled') {
        setScannerConfig({isOpen: false, mode: null});
        return showMessage("Uyarı", "Bu masa kullanıma kapatılmıştır.", "warning");
    }
    
    const safeUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const freshUser = safeUsers.find(u => u.id === currentUser.id);
    if (!freshUser || isRestricted(freshUser) || freshUser.blocked) return showMessage('Erişim Kısıtlı', 'Aktif ve onaylanmış hesap gereklidir.', 'danger');
    if (lostDeskToday(freshUser, deskId)) {
      ;
      return showMessage('Masa Kısıtı', 'İhlal nedeniyle kaybettiğiniz masayı bugün tekrar alamazsınız.', 'warning');
    }
    if (desk.status !== 'available') return showMessage('Masa Dolu', 'Her masa tek kişiliktir. Lütfen boş bir masa seçin.', 'warning');

    
    if (freshUser && freshUser.activeDeskId) {
        setScannerConfig({isOpen: false, mode: null});
        return showMessage("İşlem Reddedildi", "Zaten aktif bir masanız bulunuyor. Masa değiştirmek için önce masanızı bırakmalısınız.", "danger");
    }

    // SERT KURAL: QR onayında kullanıcının başka bir masa için geçerli bekleyen rezervasyonu varsa
    // mevcut QR işlemi de reddedilir. Böylece arayüz/state yarışlarıyla ikinci masa açılamaz.
    const ownPendingDeskLockAtQr = getOwnPendingDeskLock(currentUser.id, deskId);
    if (ownPendingDeskLockAtQr) {
        const lockedDeskId = Number(ownPendingDeskLockAtQr.pendingDeskId);
        setScannerConfig({isOpen: false, mode: null});
        addLog(
          'AYNI_KULLANICI_IKINCI_REZERVASYON_ENGELLENDI',
          `QR doğrulama sırasında ikinci rezervasyon girişimi engellendi. Kullanıcının Masa ${lockedDeskId} rezervasyonu varken Masa ${deskId} QR kodu doğrulanmaya çalışıldı.`,
          deskId,
          currentUser.id,
          false,
          null,
          { deviceId, lockedDeskId, attemptedDeskId: deskId, pendingDeadline: ownPendingDeskLockAtQr.pendingDeskDeadline, strictRule: true, phase: 'qr' }
        );
        return showMessage(
          "İkinci Masa Kesinlikle Yasak",
          `Masa ${lockedDeskId} için aktif rezervasyonunuz bulunuyor. Aynı kullanıcı veya aynı cihaz üzerinden ikinci masa açılamaz.`,
          "danger"
        );
    }
    
    // QR doğrulama anında da aynı cihaz = tek masa kuralını tekrar kontrol et.
    const deviceDeskLock = getDeviceDeskLock(currentUser.id);
    if (deviceDeskLock) {
        const lockedDeskId = deviceDeskLock.activeDeskId || deviceDeskLock.pendingDeskId;
        const lockType = deviceDeskLock.activeDeskId ? 'aktif olarak kullanılıyor' : 'QR doğrulaması bekliyor';
        setScannerConfig({isOpen: false, mode: null});
        setDesks(prev => Array.isArray(prev) ? prev.map(d => d.pendingOccupant === currentUser.id ? { ...d, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null } : d) : []);
        setUsers(prev => Array.isArray(prev) ? prev.map(u => u.id === currentUser.id ? { ...u, pendingDeskId: null, pendingDeskDeadline: null } : u) : []);
        setCurrentUser(prev => prev ? { ...prev, pendingDeskId: null, pendingDeskDeadline: null } : prev);
        setSelectedDeskId(null);
        setDeskSelectionDeadline(null);
        addLog('AYNI_CIHAZ_IKINCI_MASA_ENGELLENDI', `QR doğrulama sırasında aynı cihazdan ikinci masa alma girişimi engellendi. Masa ${lockedDeskId} bu cihazda ${deviceDeskLock.name || 'başka bir kullanıcı'} adına ${lockType}.`, deskId, currentUser.id, false, null, { deviceId, lockedUserId: deviceDeskLock.id, lockedDeskId, attemptedDeskId: deskId, strictRule: true, rule: 'ONE_DEVICE_ONE_DESK', phase: 'qr' });
        return showMessage("Bu Cihazda Zaten Masa Var", `Aynı cihaz üzerinden yalnızca 1 masa kullanılabilir. Bu cihazda Masa ${lockedDeskId} başka bir kullanıcı adına ${lockType}.`, "danger");
    }
    
    if (freshUser && freshUser.strikes >= settings.strikeLimit) {
        setScannerConfig({isOpen: false, mode: null});
        return showMessage("Erişim Engellendi", "Günlük ihlal limitini doldurduğunuz için bugün masa alamazsınız.", "danger");
    }

    const nowTime = Date.now();

    // Masa boşsa ilk kişi ana kullanıcı olur. Masa doluysa ve misafir yeri boşsa ikinci kişi misafir olur.
    if (desk.status === 'available') {
      let claimed = null;
      if (db) {
        if (!fbUser || !navigator.onLine || Date.now() < quotaBackoffUntilRef.current) return showMessage('Bağlantı Bekleniyor', 'QR doğrulaması için sunucu bağlantısı gerekli.', 'warning');
        if (deskActionInFlightRef.current) return;
        deskActionInFlightRef.current = true;
        try {
          claimed = await runStudentDeskAction('claim', { deskId, deviceId, qrCode: qrData });
          applyCloudRows(claimed);
        } catch (error) { handleFirestoreQuotaError(error); return showMessage('Masa Alınamadı', error.message, 'warning'); }
        finally { deskActionInFlightRef.current = false; }
        if (claimed.alreadyApplied) { setScannerConfig({ isOpen: false, mode: null }); return; }
      }
      const nextDesks = claimed ? desksRef.current : safeDesks.map(d => d.id === deskId ? {
        ...d, status: 'occupied', occupant: currentUser.id, ownerDeviceId: deviceId, sessionStartTime: nowTime,
        pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null
      } : d);
      const nextUsers = claimed ? usersRef.current : safeUsers.map(u => u.id === currentUser.id ? {
        ...u, activeDeskId: deskId, activeDeskRole: 'owner', deviceId: deviceId, lastActiveTime: nowTime,
        pendingDeskId: null, pendingDeskDeadline: null
      } : u);
      criticalDeskMutationRef.current = true;
      desksRef.current = nextDesks;
      usersRef.current = nextUsers;
      confirmedDeskGuardRef.current = { userId: currentUser.id, deskId, role: 'owner', deviceId, confirmedAt: nowTime, expiresAt: nowTime + 30000 };
      pendingReservationGuardRef.current = null;
      setDesks(nextDesks);
      setUsers(nextUsers);
      setCurrentUser(prev => ({...prev, ...(claimed?.user || {}), activeDeskId: deskId, activeDeskRole: 'owner', pendingDeskId: null, pendingDeskDeadline: null}));
      setSelectedDeskId(null);
      setDeskSelectionDeadline(null);
      addLog('MASA_ALINDI', `Masa ${deskId} başarıyla alındı.`, deskId, currentUser.id);
      addLog('MASAYA_GECTI', `Masa ${deskId} için 5 dakikalık rezervasyon QR doğrulamasıyla tamamlandı. Öğrenci masaya geçti ve ana kullanıcı oturumu başlatıldı.`, deskId, currentUser.id, false, null, { deskRole: 'owner', confirmedAt: nowTime });
      setScannerConfig({isOpen:false, mode:null});
      return showMessage("Başarılı", `Masa ${deskId} kullanımınıza açıldı.`, "success");
    }

    if (false) { // Misafir oturumu artık kullanıma kapalı.
      // QR doğrulama aşamasında ikinci güvenlik kontrolü:
      // Ana kullanıcının masayı aldığı cihaz ile misafir kullanıcının cihazı aynıysa işlem kesinlikle tamamlanmaz.
      const ownerUserAtQr = safeUsers.find(u => u.id === desk.occupant);
      const ownerDeviceIdAtQr = desk.ownerDeviceId || ownerUserAtQr?.deviceId || null;

      if (ownerDeviceIdAtQr && ownerDeviceIdAtQr === deviceId) {
        setScannerConfig({isOpen:false, mode:null});
        setDesks(prev => Array.isArray(prev) ? prev.map(d =>
          d.id === deskId && d.pendingOccupant === currentUser.id
            ? { ...d, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null }
            : d
        ) : []);
        setUsers(prev => Array.isArray(prev) ? prev.map(u =>
          u.id === currentUser.id ? { ...u, pendingDeskId: null, pendingDeskDeadline: null } : u
        ) : []);
        setCurrentUser(prev => prev ? { ...prev, pendingDeskId: null, pendingDeskDeadline: null } : prev);
        setSelectedDeskId(null);
        setDeskSelectionDeadline(null);
        addLog(
          'AYNI_CIHAZDAN_MISAFIR_GIRISI_ENGELLENDI',
          `QR doğrulama sırasında Masa ${deskId} ana kullanıcısının kullandığı aynı cihazdan misafir kullanıcı girişi engellendi.`,
          deskId,
          currentUser.id,
          false,
          null,
          {
            deviceId,
            ownerUserId: desk.occupant,
            ownerDeviceId: ownerDeviceIdAtQr,
            attemptedGuestUserId: currentUser.id,
            strictRule: true,
            rule: 'OWNER_DEVICE_CANNOT_JOIN_AS_GUEST',
            phase: 'qr'
          }
        );
        return showMessage(
          "Aynı Cihazdan Misafir Girişi Yasak",
          `Masa ${deskId} ana kullanıcısı bu cihazdan giriş yaptı. Misafir kullanıcı olarak aynı masaya katılmak için farklı bir cihaz kullanmalısınız.`,
          "danger"
        );
      }

      const nextDesks = safeDesks.map(d => d.id === deskId ? {
        ...d, guestOccupant: currentUser.id, guestSessionStartTime: nowTime, guestBreakEndTime: null, guestReported: false, guestReportEndTime: null,
        pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null
      } : d);
      const nextUsers = safeUsers.map(u => u.id === currentUser.id ? {
        ...u, activeDeskId: deskId, activeDeskRole: 'guest', deviceId: deviceId, lastActiveTime: nowTime,
        pendingDeskId: null, pendingDeskDeadline: null
      } : u);
      criticalDeskMutationRef.current = true;
      desksRef.current = nextDesks;
      usersRef.current = nextUsers;
      confirmedDeskGuardRef.current = { userId: currentUser.id, deskId, role: 'guest', deviceId, confirmedAt: nowTime, expiresAt: nowTime + 30000 };
      pendingReservationGuardRef.current = null;
      setDesks(nextDesks);
      setUsers(nextUsers);
      setCurrentUser(prev => ({...prev, activeDeskId: deskId, activeDeskRole: 'guest', pendingDeskId: null, pendingDeskDeadline: null}));
      setSelectedDeskId(null);
      setDeskSelectionDeadline(null);
      addLog('MISAFIR_KATILDI', `Masa ${deskId} için ikinci kullanıcı misafir olarak QR kod ile katıldı.`, deskId, currentUser.id);
      addLog('MASAYA_GECTI', `Masa ${deskId} için 5 dakikalık rezervasyon QR doğrulamasıyla tamamlandı. Öğrenci masaya geçti ve misafir oturumu başlatıldı.`, deskId, currentUser.id, false, null, { deskRole: 'guest', confirmedAt: nowTime });
      setScannerConfig({isOpen:false, mode:null});
      return showMessage("Misafir Olarak Katıldınız", `Masa ${deskId} dolu olduğu için ikinci kullanıcı olarak MİSAFİR kaydınız açıldı.`, "success");
    }

    setScannerConfig({isOpen: false, mode: null});
    return showMessage("İşlem Başarısız", "Bu masa şu anda kullanıma uygun değil. Her masa yalnızca bir öğrenci tarafından kullanılabilir.", "danger");
  };

  const releaseDesk = () => {
    if (!currentUser) return;
    const latestUser = usersRef.current.find(u => u.id === currentUser.id);
    const ownedDesk = desksRef.current.find(d => d.occupant === currentUser.id || d.guestOccupant === currentUser.id);
    const releaseDeskId = ownedDesk?.id || latestUser?.activeDeskId || currentUser.activeDeskId;
    if (!releaseDeskId) return showMessage('Masa Bilgisi', 'Aktif masa kaydı bulunamadı. Güncel masa bilgilerini kontrol edin.', 'warning');

    setModal({
        isOpen: true,
        title: "Masayı Bırak",
        type: 'warning',
        content: (
            <div className="space-y-4">
                <p className="text-slate-600 font-medium">Masa kullanımınızı tamamen sonlandırmak istediğinize emin misiniz? (Bu işlem masayı diğer kullanıcılara açar. 30 dakika boyunca yeniden masa alamazsınız; sistem hatasında yönetici masa atayabilir.)</p>
                <div className="flex gap-3">
                    <button onClick={closeMessage} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors">İptal</button>
                    <button onClick={async () => {
                        const leavingUserId = currentUser.id;
                        const deskId = releaseDeskId;
                        const nowTime = Date.now();

                        if (db) {
                          try {
                            const result = await runStudentDeskAction('leave', { deskId });
                            if (!result?.desk && !result?.desks?.length) {
                              throw new Error('Sunucu masa bırakma işleminin güncel masa kaydını döndürmedi. İşlem doğrulanamadı.');
                            }
                            const returnedDesk = result.desk || result.desks.find(d => Number(d.id) === Number(deskId));
                            if (!returnedDesk || returnedDesk.occupant === leavingUserId || returnedDesk.guestOccupant === leavingUserId) {
                              throw new Error('Sunucu kaydında masa hâlâ hesabınıza bağlı. Masa bırakma işlemi tamamlanmadı.');
                            }
                            applyCloudRows(result);
                            confirmedDeskGuardRef.current = null;
                            pendingReservationGuardRef.current = null;
                            setSelectedDeskId(null);
                            setDeskSelectionDeadline(null);
                            setScannerConfig({ isOpen: false, mode: null, title: '' });
                            releasedDeskGuardRef.current = {
                              userId: leavingUserId,
                              deskId: Number(deskId),
                              mode: result.leaveMode || 'desk_empty',
                              releasedAt: result.at || nowTime,
                              expiresAt: (result.at || nowTime) + 45000
                            };
                            addLog('MASA_BIRAKILDI', `Masa ${deskId} isteyerek bırakıldı. Masa ve bekleyen rezervasyon kayıtları temizlendi.`, deskId, leavingUserId);
                            addLog('MASA_BEKLEME_BASLADI', 'Masa bırakıldı; 30 dakikalık yeniden masa alma bekleme süresi başladı.', deskId, leavingUserId);
                            closeMessage();
                            setView('student_dash');
                            setTimeout(() => showMessage(
                              'Başarılı',
                              result.leaveMode === 'desk_empty'
                                ? 'Masanızı bıraktınız. 30 dakika sonra yeniden masa alabilirsiniz. Sistem hatasında yönetici masa atayabilir.'
                                : 'Masa oturumunuz sonlandırıldı. Sistem durumu senkronize edildi.',
                              'success'
                            ), 300);
                          } catch (error) {
                            handleFirestoreQuotaError(error);
                            showMessage('Masa Bırakılamadı', error.message, 'warning');
                          }
                          return;
                        }

                        const liveDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
                        const liveUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
                        const currentDesk = liveDesks.find(d => Number(d.id) === Number(deskId));
                        const currentRole = currentUser.activeDeskRole || (currentDesk?.guestOccupant === leavingUserId ? 'guest' : 'owner');

                        /*
                         * MASA BIRAKMA KRİTİK TEMİZLİĞİ
                         * 1) Masa alınırken kullanılan 30 sn "dolu tut" koruması anında iptal edilir.
                         * 2) Masa / kullanıcı bilgileri önce Ref üzerinde senkron olarak temizlenir.
                         * 3) Ardından 45 sn "bırakıldı" koruması açılır.
                         * Böylece gecikmiş Firestore snapshot'ı yönetici panelinde
                         * BOŞ / ÖĞRENCİ MASADA şeklinde yanıp sönme oluşturamaz.
                         */
                        confirmedDeskGuardRef.current = null;
                        pendingReservationGuardRef.current = null;

                        setSelectedDeskId(null);
                        setDeskSelectionDeadline(null);
                        setScannerConfig({ isOpen: false, mode: null, title: '' });

                        let releaseMode = 'desk_empty';
                        let promotedId = null;
                        let promotedSessionStartTime = null;

                        let nextDesks = liveDesks.map(d => {
                          const clearOwnPending = d.pendingOccupant === leavingUserId;

                          if (Number(d.id) !== Number(deskId)) {
                            return clearOwnPending
                              ? { ...d, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null }
                              : d;
                          }

                          if (currentRole === 'guest') {
                            // Misafir ayrılır; ana kullanıcı masada kalır.
                            releaseMode = 'guest_left';
                            return {
                              ...d,
                              guestOccupant: null,
                              guestSessionStartTime: null,
                              guestBreakEndTime: null,
                              guestReported: false,
                              guestReportEndTime: null,
                              guestReportIssuedAt: null,
                              guestReportVerifiedAt: null,
                              ...(clearOwnPending ? {
                                pendingOccupant: null,
                                pendingDeskRole: null,
                                pendingDeskDeadline: null
                              } : {})
                            };
                          }

                          if (currentDesk?.guestOccupant) {
                            // Ana kullanıcı ayrılır; misafir ana kullanıcıya terfi eder.
                            releaseMode = 'owner_promoted_guest';
                            promotedId = currentDesk.guestOccupant;
                            promotedSessionStartTime = currentDesk.guestSessionStartTime || nowTime;

                            return {
                              ...d,
                              occupant: promotedId,
                              ownerDeviceId: liveUsers.find(u => u.id === promotedId)?.deviceId || null,
                              sessionStartTime: promotedSessionStartTime,
                              status: 'occupied',
                              breakEndTime: null,
                              reportEndTime: null,
                              reportIssuedAt: null,
                              reportVerifiedAt: null,
                              guestOccupant: null,
                              guestSessionStartTime: null,
                              guestBreakEndTime: null,
                              guestReported: false,
                              guestReportEndTime: null,
                              guestReportIssuedAt: null,
                              guestReportVerifiedAt: null,
                              pendingOccupant: null,
                              pendingDeskRole: null,
                              pendingDeskDeadline: null
                            };
                          }

                          // Masada başka kullanıcı yoksa masa tamamen boşaltılır.
                          releaseMode = 'desk_empty';
                          return {
                            ...d,
                            status: d.status === 'disabled' ? 'disabled' : 'available',
                            occupant: null,
                            ownerDeviceId: null,
                            sessionStartTime: null,
                            breakEndTime: null,
                            reportEndTime: null,
                            reportIssuedAt: null,
                            reportVerifiedAt: null,
                            guestOccupant: null,
                            guestSessionStartTime: null,
                            guestBreakEndTime: null,
                            guestReported: false,
                            guestReportEndTime: null,
                            guestReportIssuedAt: null,
                            guestReportVerifiedAt: null,
                            pendingOccupant: null,
                            pendingDeskRole: null,
                            pendingDeskDeadline: null
                          };
                        });

                        let nextUsers = liveUsers.map(u => {
                          if (u.id === leavingUserId) {
                            return {
                              ...u,
                              activeDeskId: null,
                              activeDeskRole: null,
                              pendingDeskId: null,
                              pendingDeskDeadline: null,
                              lastActiveTime: nowTime,
                              deskReleasedAt: nowTime, deskReclaimAllowedAt: nowTime + DESK_RECLAIM_WAIT_MS, gmDeskAccessAt: nowTime
                            };
                          }

                          if (promotedId && u.id === promotedId) {
                            return {
                              ...u,
                              activeDeskId: deskId,
                              activeDeskRole: 'owner',
                              lastActiveTime: nowTime
                            };
                          }

                          return u;
                        });

                        // KRİTİK: Bu gerçek bir yerel masa bırakma işlemidir.
                        // Snapshot aynı anda gelse bile Firestore'a mutlaka yazılmalıdır.
                        criticalDeskMutationRef.current = true;

                        // KRİTİK: React state kuyruğunu beklemeden canlı Ref'leri anında güncelle.
                        // onSnapshot aynı milisaniyede çalışsa bile eski dolu durumu göremez.
                        desksRef.current = nextDesks;
                        usersRef.current = nextUsers;

                        releasedDeskGuardRef.current = {
                          userId: leavingUserId,
                          deskId: Number(deskId),
                          mode: releaseMode,
                          promotedUserId: promotedId,
                          promotedSessionStartTime,
                          releasedAt: nowTime,
                          expiresAt: nowTime + 45000
                        };

                        setDesks(nextDesks);
                        setUsers(nextUsers);

                        setCurrentUser(prev => prev ? ({
                          ...prev,
                          activeDeskId: null,
                          activeDeskRole: null,
                          pendingDeskId: null,
                          pendingDeskDeadline: null,
                          lastActiveTime: nowTime,
                          deskReleasedAt: nowTime, deskReclaimAllowedAt: nowTime + DESK_RECLAIM_WAIT_MS, gmDeskAccessAt: nowTime
                        }) : prev);

                        if (releaseMode === 'guest_left') {
                          addLog('MISAFIR_AYRILDI', `Masa ${deskId} misafiri oturumunu sonlandırdı.`, deskId, leavingUserId);
                        } else if (releaseMode === 'owner_promoted_guest') {
                          addLog('MISAFIR_ANA_KULLANICI', `Masa ${deskId} ana kullanıcısı ayrıldığı için misafir ana kullanıcı olarak devam etti.`, deskId, promotedId);
                        } else {
                          addLog('MASA_BIRAKILDI', `Masa ${deskId} isteyerek bırakıldı. Masa ve bekleyen rezervasyon kayıtları tamamen temizlendi.`, deskId, leavingUserId);
                        }

                        addLog(
                          'MASA_BIRAKMA_TEMIZLIK',
                          `Kullanıcının Masa ${deskId} oturumu sonlandırıldı; aktif masa ve bekleyen masa rezervasyonu temizlendi. Firestore eski snapshot koruması devreye alındı.`,
                          deskId,
                          leavingUserId,
                          false,
                          null,
                          { releaseMode, releasedAt: nowTime }
                        );

                        closeMessage();
                        setView('student_dash');
                        addLog('MASA_BEKLEME_BASLADI', 'Masa bırakıldı; 30 dakikalık yeniden masa alma bekleme süresi başladı.', deskId, leavingUserId);
                        setTimeout(() => showMessage(
                          "Başarılı",
                          releaseMode === 'desk_empty'
                            ? "Masanızı bıraktınız. 30 dakika sonra yeniden masa alabilirsiniz. Sistem hatasında yönetici masa atayabilir."
                            : "Masa oturumunuz sonlandırıldı. Sistem durumu senkronize edildi.",
                          "success"
                        ), 300);
                    }} className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-md transition-colors">Eminim, Bırak</button>
                </div>
            </div>
        )
    });
  };

  const startBreak = async (type) => {
    if (!currentUser || !currentUser.activeDeskId) return;
    const safeUsers = Array.isArray(users) ? users : [];
    const myUser = safeUsers.find(u => u.id === currentUser.id);
    if (!myUser) return;
    
    if (myUser.breaks[type] <= 0) return showMessage("Uyarı", "Bu mola hakkınız tükenmiş.", "warning");

    const lastActive = Number(myUser.lastActiveTime || 0);
    // Peş peşe mola kullanımını engelle: her mola arasında en az 30 dk aktif çalışma zorunlu.
    // Yönetici daha yüksek bir değer belirlerse o değer uygulanır; 30 dakikanın altına düşmez.
    const configuredCooldown = Number.isFinite(Number(settings.breakCooldown)) ? Number(settings.breakCooldown) : 30;
    const requiredWorkMinutes = Math.max(30, configuredCooldown);
    const cooldownMs = requiredWorkMinutes * 60 * 1000;
    if (now - lastActive < cooldownMs) {
        const remainingMs = cooldownMs - (now - lastActive);
        const remainingMin = Math.ceil(remainingMs / 60000);
        const breakLabel = type === 'short' ? 'Kısa mola' : 'Uzun mola';
        return showMessage(
          `${breakLabel} İçin Çalışma Süresi`,
          `${breakLabel} kullanabilmek için toplam ${requiredWorkMinutes} dakika aktif ders çalışmanız gerekiyor. Şu anda ${remainingMin} dakika daha çalışmalısınız.`,
          "warning"
        );
    }

    const durationStr = type === 'short' ? settings.shortBreakDuration : settings.longBreakDuration;
    const durationMs = durationStr * 60 * 1000;

    const myRole = myUser.activeDeskRole || 'owner';
    if (db) {
      try {
        const result = await runStudentDeskAction('break-start', { deskId: currentUser.activeDeskId, type });
        applyCloudRows(result);
      } catch (error) {
        handleFirestoreQuotaError(error);
        return showMessage('Mola Başlatılamadı', error.message, 'warning');
      }
    } else {
      setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === currentUser.activeDeskId
        ? (myRole === 'guest'
            ? { ...d, guestBreakEndTime: Date.now() + durationMs }
            : { ...d, status: 'on_break', breakEndTime: Date.now() + durationMs })
        : d) : []);
      setUsers(prev => Array.isArray(prev) ? prev.map(u => u.id === currentUser.id ? { ...u, breaks: { ...u.breaks, [type]: u.breaks[type] - 1 } } : u) : []);
    }
    
    addLog('MOLA_BAŞLADI', `${myRole === 'guest' ? 'Misafir - ' : ''}${type === 'short' ? 'Kısa' : 'Uzun'} mola başlatıldı.`, currentUser.activeDeskId, currentUser.id);
  };

  const returnFromBreak = async (qrData) => {
    if (!currentUser || !currentUser.activeDeskId) {
      setScannerConfig({ isOpen: false, mode: null });
      return showMessage("Hata", "Aktif masa bilginiz bulunamadı.", "danger");
    }

    const parts = String(qrData || '').split('-');
    if (parts.length < 3) {
      setScannerConfig({ isOpen: false, mode: null });
      return showMessage("Hata", "Geçersiz QR Kod.", "danger");
    }

    const deskId = parseInt(parts[1]);
    const safeDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
    const myDesk = safeDesks.find(d => d.id === currentUser.activeDeskId);
    const myFreshUser = (Array.isArray(usersRef.current) ? usersRef.current : []).find(u => u.id === currentUser.id);
    const myRole = myFreshUser?.activeDeskRole || currentUser.activeDeskRole || 'owner';

    if (myRole === 'guest') {
      if (!myDesk || !myDesk.guestBreakEndTime) {
        setScannerConfig({ isOpen: false, mode: null });
        return showMessage("Uyarı", "Misafir oturumunuz şu anda mola durumunda değil.", "warning");
      }
      if (deskId !== currentUser.activeDeskId || qrData !== myDesk.qrCode) {
        setScannerConfig({ isOpen: false, mode: null });
        return showMessage("Hata", "Moladan dönmek için bulunduğunuz masanın güncel karekodunu okutmalısınız.", "danger");
      }
      if (db) {
        try {
          const result = await runStudentDeskAction('break-end', { deskId: currentUser.activeDeskId, qrCode: qrData });
          applyCloudRows(result);
        } catch (error) {
          handleFirestoreQuotaError(error);
          return showMessage('Moladan Dönülemedi', error.message, 'warning');
        }
      } else {
        setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === currentUser.activeDeskId ? { ...d, guestBreakEndTime: null } : d) : []);
        setUsers(prev => Array.isArray(prev) ? prev.map(u => u.id === currentUser.id ? { ...u, lastActiveTime: Date.now() } : u) : []);
      }
      addLog('MOLA_BİTTİ', `Misafir kullanıcı masa QR kodunu okutarak moladan erken döndü.`, currentUser.activeDeskId, currentUser.id);
      setScannerConfig({ isOpen: false, mode: null });
      return showMessage("Hoş Geldiniz", "QR doğrulandı. Misafir molanız sonlandırıldı.", "success");
    }

    if (!myDesk || myDesk.status !== 'on_break') {
      setScannerConfig({ isOpen: false, mode: null });
      return showMessage("Uyarı", "Masanız şu anda mola durumunda değil.", "warning");
    }

    if (deskId !== currentUser.activeDeskId || qrData !== myDesk.qrCode) {
      setScannerConfig({ isOpen: false, mode: null });
      return showMessage("Hata", "Moladan dönmek için kendi masanızdaki güncel karekodu okutmalısınız.", "danger");
    }

    if (db) {
      try {
        const result = await runStudentDeskAction('break-end', { deskId: currentUser.activeDeskId, qrCode: qrData });
        applyCloudRows(result);
      } catch (error) {
        handleFirestoreQuotaError(error);
        return showMessage('Moladan Dönülemedi', error.message, 'warning');
      }
    } else {
      setDesks(prev => Array.isArray(prev) ? prev.map(d =>
        d.id === currentUser.activeDeskId
          ? { ...d, status: 'occupied', breakEndTime: null }
          : d
      ) : []);

      setUsers(prev => Array.isArray(prev) ? prev.map(u =>
        u.id === currentUser.id
          ? { ...u, lastActiveTime: Date.now() }
          : u
      ) : []);
    }

    addLog('MOLA_BİTTİ', `Öğrenci kendi masasının QR kodunu okutarak moladan erken döndü.`, currentUser.activeDeskId, currentUser.id);
    setScannerConfig({ isOpen: false, mode: null });
    showMessage("Hoş Geldiniz", "QR doğrulandı. Molanız sonlandırıldı ve masanız tekrar aktif edildi.", "success");
  };

  const promptReportDesk = (deskId) => {
    const myUser = requireStudentAction('Boş masa ihbarı');
    if (!myUser) return;
    if (settings.reportsEnabled === false) return showMessage('İhbar Kapalı', 'Boş masa ihbarları sistem genelinde kapalıdır.', 'warning');
    if (myUser.canReport === false) return showMessage('İhbar Yetkisi Kapalı', 'Hesabınızın ihbar yetkisi kapalıdır. Kütüphane sorumlusu kullanıcı düzenleme ekranından bu yetkiyi açabilir.', 'warning');
    const safeUsers = Array.isArray(usersRef.current) ? usersRef.current : [];

    const safeDesks = Array.isArray(desks) ? desks : [];
    const desk = safeDesks.find(d => Number(d.id) === Number(deskId));
    if(!desk) return showMessage("Uyarı", "Masa bulunamadı.", "warning");
    if (desk.status === 'on_break') return showMessage('Masa Molada', 'Resmî moladaki masa ihbar edilemez.', 'info');
    if(desk.status === 'disabled' || !desk.occupant) return showMessage("Uyarı", "Bu masada ihbar edilebilecek aktif kullanıcı bulunmuyor.", "warning");
    if(deskId === currentUser.activeDeskId) return showMessage("Uyarı", "Kendi bulunduğunuz masadaki kişileri ihbar edemezsiniz.", "warning");

    // Öğrenci yalnızca kendi hesap belgesini okur. Hedef kimliği masa kaydından gelir;
    // diğer öğrencilerin özel hesap bilgilerini indirmek gerekmez.
    const owner = safeUsers.find(u => u.id === desk.occupant) || { id: desk.occupant, name: 'Masa kullanıcısı' };
    const guest = desk.guestOccupant ? (safeUsers.find(u => u.id === desk.guestOccupant) || { id: desk.guestOccupant, name: 'Misafir kullanıcı' }) : null;

    const openFormFor = (targetRole) => {
      const target = targetRole === 'guest' ? guest : owner;
      if (!target) return;
      if (targetRole === 'owner' && desk.status === 'on_break') return showMessage("Bilgi", "Ana kullanıcı şu anda resmi mola durumunda; mola bitmeden ihbar edilemez.", "info");
      if (targetRole === 'guest' && desk.guestBreakEndTime && desk.guestBreakEndTime > Date.now()) return showMessage("Bilgi", "Misafir kullanıcı şu anda resmi mola durumunda; mola bitmeden ihbar edilemez.", "info");
      setReportFormContext({ deskId, targetRole, targetUserId: target.id });
      setModal({
        isOpen: true,
        title: `Masa ${deskId} - ${targetRole === 'guest' ? 'Misafir' : 'Ana Kullanıcı'} Boş Mu?`,
        content: <ReportForm deskId={deskId} reporter={currentUser} onSubmit={(id, name, identityNo) => handleReportSubmit(id, name, identityNo, targetRole, target.id)} onCancel={closeMessage} />
      });
    };

    if (guest) {
      setModal({
        isOpen: true,
        title: `Masa ${deskId} - Kimi İhbar Edeceksiniz?`,
        type: 'warning',
        content: (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Bu masada iki kullanıcı kayıtlı. Masada bulunmayan kişiyi seçin.</p>
            <button onClick={() => openFormFor('owner')} className="w-full p-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 rounded-xl font-bold text-left">Ana Kullanıcı: {owner?.name || 'Bilinmiyor'}</button>
            <button onClick={() => openFormFor('guest')} className="w-full p-3 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-800 rounded-xl font-bold text-left">Misafir: {guest.name}</button>
            <button onClick={closeMessage} className="w-full p-3 bg-slate-100 text-slate-700 rounded-xl font-bold">İptal</button>
          </div>
        )
      });
    } else {
      openFormFor('owner');
    }
  };

  const handleReportSubmit = async (deskId, name, identityNo, targetRole = 'owner', targetUserId = null) => {
    const freshReporter = requireStudentAction('Boş masa ihbarı gönderme');
    if (!freshReporter) return;
    if (freshReporter.canReport === false || settings.reportsEnabled === false) return showMessage('İhbar Kapalı', 'İhbar etme yetkisi kapalıdır.', 'warning');
    // İHBAR EDEN KİŞİ KAYIT KONTROLÜ:
    // İhbar gönderebilmek için girilen ad-soyad ve kimlik numarası AYNI kayıtlı kullanıcıyla eşleşmelidir.
    // Böylece rastgele / uydurma bilgilerle ihbar oluşturulamaz.
    const registeredUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const registeredReporter = freshReporter;
    name = registeredReporter.name;
    identityNo = registeredReporter.specialCode;
    const reportedDesk = (desksRef.current || []).find(d => Number(d.id) === Number(deskId));
    const occupantId = targetRole === 'guest' ? reportedDesk?.guestOccupant : reportedDesk?.occupant;
    if (!reportedDesk || !occupantId || occupantId !== targetUserId || occupantId === freshReporter.id ||
        reportedDesk.status === 'disabled' || (targetRole === 'owner' && ['on_break', 'reported'].includes(reportedDesk.status)) ||
        (targetRole === 'guest' && (reportedDesk.guestReported || Number(reportedDesk.guestBreakEndTime || 0) > Date.now()))) {
      return showMessage('İhbar Gönderilemedi', 'Masa durumu değişti veya bu kullanıcı için ihbar uygun değil.', 'warning');
    }

    let reportWaitMinutes = Number.isFinite(Number(settings.reportWaitTime)) && Number(settings.reportWaitTime) > 0 ? Number(settings.reportWaitTime) : 5;
    const waitTimeMs = reportWaitMinutes * 60 * 1000;
    const notificationTargetUserId = targetUserId || currentUser.id;
    const reportIssuedAt = Date.now();

    let reportLog = null;

    if (targetRole === 'guest') {
      if (db) return showMessage('İhbar Gönderilemedi', 'Misafir oturumları için ihbar işlemi artık desteklenmiyor.', 'warning');
      setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === deskId ? { ...d, guestReported: true, guestReportIssuedAt: reportIssuedAt, guestReportVerifiedAt: null, guestReportEndTime: reportIssuedAt + waitTimeMs } : d) : []);
      reportLog = addLog('İHBAR_MISAFIR', `Masa ${deskId} misafir kullanıcısı masada bulunmadığı gerekçesiyle ihbar edildi. Bildiren: ${name} (${identityNo})`, deskId, notificationTargetUserId);

      // Mevcut ihbar akışını değiştirmeden hedef misafir kullanıcının telefonuna gerçek push gönder.
      sendServerPush({
        userId: notificationTargetUserId,
        title: '🚨 Masa İhbarı!',
        body: `Masa ${deskId} üzerindeki misafir oturumunuz masada bulunmadığınız gerekçesiyle ihbar edildi. ${reportWaitMinutes} dakika içinde masanıza dönüp QR kod ile doğrulama yapın.`,
        type: 'İHBAR_MISAFIR',
        deskId,
        logId: reportLog?.id || null
      });
    } else {
      let reportEventId;
      if (db) {
        try {
          const result = await runStudentDeskAction('report', { deskId, targetUserId: notificationTargetUserId });
          reportWaitMinutes = result.waitMinutes || reportWaitMinutes;
          reportEventId = result.eventId;
          applyCloudRows(result);
        } catch (error) {
          handleFirestoreQuotaError(error);
          return showMessage('İhbar Gönderilemedi', error.message, 'warning');
        }
      } else {
        setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === deskId ? { ...d, status: 'reported', reportIssuedAt, reportVerifiedAt: null, reportEndTime: reportIssuedAt + waitTimeMs } : d) : []);
      }
      reportLog = addLog('İHBAR', `Masa ${deskId} ana kullanıcısı masada bulunmadığı gerekçesiyle ihbar edildi. Bildiren: ${name} (${identityNo})`, deskId, notificationTargetUserId, false, null, reportEventId ? { eventId: reportEventId } : null);

      // Mevcut ihbar akışını değiştirmeden masa sahibinin telefonuna gerçek push gönder.
      sendServerPush({
        userId: notificationTargetUserId,
        title: '🚨 Masanız İhbar Edildi!',
        body: `Masa ${deskId} boş olduğu gerekçesiyle ihbar edildi. ${reportWaitMinutes} dakika içinde masanıza dönüp QR kod ile “Masadayım” doğrulaması yapın.`,
        type: 'İHBAR',
        deskId,
        logId: reportLog?.id || null
      });
    }

    closeMessage();
    showMessage("İhbar Alındı", `Masa ${deskId} için ${targetRole === 'guest' ? 'misafir' : 'ana kullanıcı'} adına ${reportWaitMinutes} dakikalık doğrulama süreci başlatıldı.`, "success");
  };

  const handleVerifyImHere = async (qrData) => {
    const parts = qrData.split('-');
    if (parts.length < 2) {
        setScannerConfig({isOpen: false, mode: null});
        return showMessage("Hata", "Geçersiz QR Kod.", "danger");
    }
    const deskId = parseInt(parts[1]);

    if(deskId !== currentUser.activeDeskId) {
       setScannerConfig({isOpen: false, mode: null});
       return showMessage("Hata", "Lütfen size ait olan masanın karekodunu okutunuz.", "danger");
    }

    const nowTime = Date.now();
    const liveUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const liveDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
    const verifyUser = liveUsers.find(u => u.id === currentUser.id);
    const verifyRole = verifyUser?.activeDeskRole || currentUser.activeDeskRole || 'owner';

    if (db) {
      try {
        const result = await runStudentDeskAction('verify', { deskId, qrCode: qrData });
        applyCloudRows(result);
      } catch (error) {
        handleFirestoreQuotaError(error);
        setScannerConfig({ isOpen: false, mode: null, title: '' });
        return showMessage('Doğrulama Başarısız', error.message, 'warning');
      }
    } else {
    // QR doğrulaması state kuyruğuna bırakılmadan önce Ref üzerinde de anında uygulanır.
    // 1 saniyelik ihlal zamanlayıcısı aynı anda çalışsa bile artık eski "reported" durumunu göremez.
    const verifiedDesks = liveDesks.map(d => d.id === deskId
      ? (verifyRole === 'guest'
          ? {
              ...d,
              guestReported: false,
              guestReportEndTime: null,
              guestReportVerifiedAt: nowTime
            }
          : {
              ...d,
              status: 'occupied',
              reportEndTime: null,
              reportVerifiedAt: nowTime
            })
      : d);

    desksRef.current = verifiedDesks;
    setDesks(verifiedDesks);

    const verifiedUsers = liveUsers.map(u => u.id === currentUser.id
      ? { ...u, lastActiveTime: nowTime }
      : u);
    usersRef.current = verifiedUsers;
    setUsers(verifiedUsers);
    setCurrentUser(prev => prev ? { ...prev, lastActiveTime: nowTime } : prev);
    }

    // Aynı ihbar için bildirim anahtarını da çözüldü olarak kabul et.
    lastReportNotifiedRef.current = null;

    addLog('BILDIRIM_IPTAL', `${verifyRole === 'guest' ? 'Misafir' : 'Masa sahibi'} QR kod okutarak masada olduğunu doğruladı. İhbar süresi anında iptal edildi.`, deskId, currentUser.id);
    setScannerConfig({isOpen: false, mode: null, title: ''});
    showMessage("Başarılı", "QR doğrulandı. Öğrenci masada olarak işaretlendi ve ihbar anında iptal edildi.", "success");
  };

  const handleReportScan = (qrData) => {
    if (!requireStudentAction('Boş masa ihbarı QR doğrulama')) return;
    const parts = qrData.split('-');
    if (parts.length < 2) return showMessage("Hata", "Geçersiz QR Kod.", "danger");
    const deskId = parseInt(parts[1]);
    setScannerConfig({isOpen: false, mode: null});
    promptReportDesk(deskId);
  };

  const handleAdminQueryScan = (qrData) => {
    const parts = qrData.split('-');
    if (parts.length < 2) return showMessage("Hata", "Geçersiz QR Kod.", "danger");
    const deskId = parseInt(parts[1]);
    setScannerConfig({isOpen: false, mode: null});
    setLiveDeskId(deskId);
    setModal({ isOpen: true, type: 'info', title: `Masa ${deskId} Yönetimi`, content: null });
  };

  // --- TUTANAK YÖNETİMİ VE PDF ---
  const loadExternalScript = (src, id) => new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });

  const ensurePdfMake = async () => {
    if (window.pdfMake && window.pdfMake.vfs) return window.pdfMake;

    await loadExternalScript(
      'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js',
      'pdfmake-script'
    );
    await loadExternalScript(
      'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js',
      'pdfmake-fonts-script'
    );

    if (!window.pdfMake) throw new Error('PDF motoru yüklenemedi.');
    return window.pdfMake;
  };


  

  

  

  

  

  // İhlal Kayıtları ve Dilek / Şikayet arşivleri için PDF / Word dışa aktarma ve kayıt silme araçları.
  const escapeWordHtml = value => escapeHtml(value ?? '-');
  const downloadHtmlAsWord = (html, filename) => {
    const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadViolationRecordsWord = () => {
    try {
      const records = Array.isArray(violationRecordsRef.current) ? violationRecordsRef.current : [];
      if (records.length === 0) return showMessage('Kayıt Bulunamadı', 'Word olarak indirilecek ihlal kaydı bulunmuyor.', 'warning');

      const rows = records.map((record, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeWordHtml(new Date(record.time).toLocaleString('tr-TR'))}</td>
          <td>${escapeWordHtml(record.userInfo || '-')}</td>
          <td>${escapeWordHtml(record.deskId || '-')}</td>
          <td>${escapeWordHtml(String(record.type || 'IHLAL').replace(/_/g, ' '))}</td>
          <td>${escapeWordHtml(record.message || '-')}</td>
          <td>${escapeWordHtml(record.deviceInfo || '-')}</td>
          <td>${escapeWordHtml(record.locationInfo || '-')}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>İhlal Kayıtları</title>
      <style>body{font-family:Arial,sans-serif;margin:30px;color:#111}h1,h2{text-align:center}table{width:100%;border-collapse:collapse;font-size:9pt}th,td{border:1px solid #999;padding:6px;vertical-align:top}th{background:#f2f2f2}.footer{text-align:center;margin-top:25px;font-size:8pt;color:#666}</style>
      </head><body><h2>SARIÇAM GENÇLİK MERKEZİ</h2><h1>İHLAL KAYITLARI RAPORU</h1>
      <p>Oluşturulma: ${escapeWordHtml(new Date().toLocaleString('tr-TR'))} &nbsp; | &nbsp; Toplam Kayıt: ${records.length}</p>
      <table><thead><tr><th>#</th><th>Tarih / Saat</th><th>Öğrenci</th><th>Masa</th><th>İhlal Türü</th><th>Açıklama</th><th>Cihaz</th><th>Konum</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="footer">Bu rapor Sarıçam Gençlik Merkezi Kütüphane Masa Takip Sistemi üzerinden oluşturulmuştur.</div></body></html>`;

      downloadHtmlAsWord(html, `Ihlal_Kayitlari_${getLocalDayKey()}.doc`);
      addLog('ARSIV_IHLAL_WORD', `İhlal Kayıtları arşivi Word olarak indirildi. Toplam ${records.length} kayıt.`);
    } catch (error) {
      console.error('İhlal Word hatası:', error);
      showMessage('Word Hatası', 'İhlal kayıtları Word dosyası oluşturulamadı.', 'danger');
    }
  };

  const downloadViolationRecordsPdf = async () => {
    try {
      const records = Array.isArray(violationRecordsRef.current) ? violationRecordsRef.current : [];
      if (records.length === 0) return showMessage('Kayıt Bulunamadı', 'PDF olarak indirilecek ihlal kaydı bulunmuyor.', 'warning');
      const pdfMake = await ensurePdfMake();
      const body = [[
        { text: '#', bold: true }, { text: 'Tarih / Saat', bold: true }, { text: 'Öğrenci', bold: true },
        { text: 'Masa', bold: true }, { text: 'Tür', bold: true }, { text: 'Açıklama', bold: true }
      ], ...records.map((r, i) => [
        String(i + 1), new Date(r.time).toLocaleString('tr-TR'), r.userInfo || '-', r.deskId ? String(r.deskId) : '-',
        String(r.type || 'IHLAL').replace(/_/g, ' '), r.message || '-'
      ])];
      pdfMake.createPdf({
        pageOrientation: 'landscape', pageSize: 'A4', pageMargins: [24, 30, 24, 30],
        content: [
          { text: 'SARIÇAM GENÇLİK MERKEZİ', bold: true, alignment: 'center', fontSize: 13 },
          { text: 'İHLAL KAYITLARI RAPORU', bold: true, alignment: 'center', fontSize: 16, margin: [0, 4, 0, 12] },
          { text: `Oluşturulma: ${new Date().toLocaleString('tr-TR')}   |   Toplam Kayıt: ${records.length}`, fontSize: 9, margin: [0, 0, 0, 10] },
          { table: { headerRows: 1, widths: [22, 82, 115, 35, 90, '*'], body }, layout: 'lightHorizontalLines', fontSize: 8 }
        ]
      }).download(`Ihlal_Kayitlari_${getLocalDayKey()}.pdf`);
      addLog('ARSIV_IHLAL_PDF', `İhlal Kayıtları arşivi PDF olarak indirildi. Toplam ${records.length} kayıt.`);
    } catch (error) {
      console.error('İhlal PDF hatası:', error);
      showMessage('PDF Hatası', 'İhlal kayıtları PDF dosyası oluşturulamadı.', 'danger');
    }
  };

  const downloadFeedbackRecordsWord = () => {
    try {
      const records = Array.isArray(feedbackRecordsRef.current) ? feedbackRecordsRef.current : [];
      if (records.length === 0) return showMessage('Kayıt Bulunamadı', 'Word olarak indirilecek dilek / şikayet kaydı bulunmuyor.', 'warning');
      const rows = records.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeWordHtml(new Date(r.time).toLocaleString('tr-TR'))}</td><td>${escapeWordHtml(r.name || '-')}</td><td>${escapeWordHtml(r.identityNo || '-')}</td><td>${escapeWordHtml(r.type === 'complaint' ? 'Şikayet' : 'Öneri')}</td><td>${escapeWordHtml(r.message || '-')}</td></tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dilek ve Şikayet Kayıtları</title><style>body{font-family:Arial,sans-serif;margin:30px;color:#111}h1,h2{text-align:center}table{width:100%;border-collapse:collapse;font-size:10pt}th,td{border:1px solid #999;padding:7px;vertical-align:top}th{background:#f2f2f2}.footer{text-align:center;margin-top:25px;font-size:8pt;color:#666}</style></head><body><h2>SARIÇAM GENÇLİK MERKEZİ</h2><h1>DİLEK / ŞİKAYET KAYITLARI RAPORU</h1><p>Oluşturulma: ${escapeWordHtml(new Date().toLocaleString('tr-TR'))} &nbsp; | &nbsp; Toplam Kayıt: ${records.length}</p><table><thead><tr><th>#</th><th>Tarih / Saat</th><th>Ad Soyad</th><th>Kimlik No</th><th>Tür</th><th>Mesaj</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Bu rapor Sarıçam Gençlik Merkezi Kütüphane Masa Takip Sistemi üzerinden oluşturulmuştur.</div></body></html>`;
      downloadHtmlAsWord(html, `Dilek_Sikayet_Kayitlari_${getLocalDayKey()}.doc`);
      addLog('GERIBILDIRIM_ARSIV_WORD', `Dilek / Şikayet arşivi Word olarak indirildi. Toplam ${records.length} kayıt.`);
    } catch (error) {
      console.error('Dilek / Şikayet Word hatası:', error);
      showMessage('Word Hatası', 'Dilek / şikayet Word dosyası oluşturulamadı.', 'danger');
    }
  };

  const downloadFeedbackRecordsPdf = async () => {
    try {
      const records = Array.isArray(feedbackRecordsRef.current) ? feedbackRecordsRef.current : [];
      if (records.length === 0) return showMessage('Kayıt Bulunamadı', 'PDF olarak indirilecek dilek / şikayet kaydı bulunmuyor.', 'warning');
      const pdfMake = await ensurePdfMake();
      const body = [[
        { text: '#', bold: true }, { text: 'Tarih / Saat', bold: true }, { text: 'Ad Soyad', bold: true },
        { text: 'Kimlik No', bold: true }, { text: 'Tür', bold: true }, { text: 'Mesaj', bold: true }
      ], ...records.map((r, i) => [String(i + 1), new Date(r.time).toLocaleString('tr-TR'), r.name || '-', r.identityNo || '-', r.type === 'complaint' ? 'Şikayet' : 'Öneri', r.message || '-'])];
      pdfMake.createPdf({
        pageOrientation: 'landscape', pageSize: 'A4', pageMargins: [24, 30, 24, 30],
        content: [
          { text: 'SARIÇAM GENÇLİK MERKEZİ', bold: true, alignment: 'center', fontSize: 13 },
          { text: 'DİLEK / ŞİKAYET KAYITLARI RAPORU', bold: true, alignment: 'center', fontSize: 16, margin: [0, 4, 0, 12] },
          { text: `Oluşturulma: ${new Date().toLocaleString('tr-TR')}   |   Toplam Kayıt: ${records.length}`, fontSize: 9, margin: [0, 0, 0, 10] },
          { table: { headerRows: 1, widths: [22, 82, 100, 72, 55, '*'], body }, layout: 'lightHorizontalLines', fontSize: 8 }
        ]
      }).download(`Dilek_Sikayet_Kayitlari_${getLocalDayKey()}.pdf`);
      addLog('GERIBILDIRIM_ARSIV_PDF', `Dilek / Şikayet arşivi PDF olarak indirildi. Toplam ${records.length} kayıt.`);
    } catch (error) {
      console.error('Dilek / Şikayet PDF hatası:', error);
      showMessage('PDF Hatası', 'Dilek / şikayet PDF dosyası oluşturulamadı.', 'danger');
    }
  };

  const deleteViolationRecord = (record) => {
    if (!record) return;
    if (!window.confirm('Bu ihlal kaydını silmek istediğinize emin misiniz?')) return;
    pushUndoSnapshot('İhlal kaydı silme');

    // Önce silinen kimliği korumaya al; gecikmiş Firestore snapshot'ı kaydı geri getiremesin.
    rememberDeletedRecordId('violations', record.id);
    deleteHistoryRecords('violations', [record.id]);

    const next = (Array.isArray(violationRecordsRef.current) ? violationRecordsRef.current : [])
      .filter(r => r.id !== record.id && !isRecordDeleted('violations', r.id));
    violationRecordsRef.current = next;
    setViolationRecords(next);
    addLog('ARSIV_IHLAL_KAYDI_SILINDI', `${record.userInfo || 'Bir öğrenci'} için ${new Date(record.time).toLocaleString('tr-TR')} tarihli ihlal kaydı yönetici tarafından silindi.`, record.deskId || null, record.userId || null);
  };

  const deleteFeedbackRecord = (record) => {
    if (!record) return;
    if (!window.confirm('Bu dilek / şikayet kaydını silmek istediğinize emin misiniz?')) return;
    pushUndoSnapshot('Dilek / şikayet kaydı silme');

    // Önce silinen kimliği korumaya al; gecikmiş Firestore snapshot'ı kaydı geri getiremesin.
    rememberDeletedRecordId('feedback', record.id);
    deleteHistoryRecords('feedback', [record.id]);

    const next = (Array.isArray(feedbackRecordsRef.current) ? feedbackRecordsRef.current : [])
      .filter(r => r.id !== record.id && !isRecordDeleted('feedback', r.id));
    feedbackRecordsRef.current = next;
    setFeedbackRecords(next);
    addLog('GERIBILDIRIM_KAYDI_SILINDI', `${record.name || 'Bir kullanıcı'} tarafından gönderilen ${record.type === 'complaint' ? 'şikayet' : 'öneri'} kaydı yönetici tarafından silindi.`);
  };

  

  const sendAdminDeskMessage = (deskId, userId, message, title = 'Yönetici Masa Kontrolü', level = 'warning') => {
    if (!userId || !message || !String(message).trim()) {
      return showMessage('Mesaj Gönderilemedi', 'Masa sahibine gönderilecek mesaj boş olamaz.', 'warning');
    }

    const numericDeskId = Number(deskId);
    const deskForMessage = (Array.isArray(desksRef.current) ? desksRef.current : [])
      .find(d => Number(d.id) === numericDeskId);

    if (!deskForMessage) {
      return showMessage('Mesaj Gönderilemedi', 'Seçilen masa sistemde bulunamadı.', 'warning');
    }

    // SERT HEDEF KONTROLÜ:
    // Yönetici mesajı yalnızca bu masanın GERÇEK ana kullanıcısına veya misafirine gönderilebilir.
    // Eski/stale bir userId başka kullanıcıya bildirim göndermesin.
    const validRecipientIds = [deskForMessage.occupant, deskForMessage.guestOccupant].filter(Boolean);
    if (!validRecipientIds.includes(userId)) {
      return showMessage(
        'Mesaj Gönderilemedi',
        `Masa ${numericDeskId} ile seçilen kullanıcı eşleşmiyor. Mesaj başka kullanıcıya gönderilmedi.`,
        'danger'
      );
    }

    const targetUser = Array.isArray(usersRef.current) ? usersRef.current.find(u => u.id === userId) : null;
    if (!targetUser) {
      return showMessage('Mesaj Gönderilemedi', 'Bu masaya bağlı kullanıcı bulunamadı.', 'warning');
    }

    const cleanMessage = String(message).trim().slice(0, 300);
    const recipientRole = deskForMessage.guestOccupant === userId ? 'guest' : 'owner';

    const adminMessageLog = addLog(
      'ADMIN_MASA_MESAJI',
      cleanMessage,
      numericDeskId,
      userId,
      false,
      null,
      {
        notificationTitle: title,
        notificationBody: cleanMessage,
        notificationLevel: level,
        sentByAdmin: true,
        recipientRole,
        recipientName: targetUser.name || '',
        deliveredAt: Date.now(),
        source: 'admin_desk_control'
      }
    );

    // Yönetici masa kontrol mesajını aynı zamanda ilgili öğrencinin telefonuna gönder.
    sendServerPush({
      userId,
      title: title || '📢 Yönetici Masa Kontrol Mesajı',
      body: cleanMessage,
      type: 'ADMIN_MASA_MESAJI',
      deskId: numericDeskId,
      logId: adminMessageLog?.id || null
    });

    showMessage(
      'Mesaj Gönderildi',
      <div className="space-y-2">
        <p className="text-sm text-slate-700"><b>{targetUser.name}</b> adlı kullanıcıya masa kontrol mesajı gönderildi.</p>
        <p className="text-xs text-slate-500">{cleanMessage}</p>
      </div>,
      'success'
    );
  };

  const openAdminDeskMessage = (deskId, userId) => {
    const targetUser = Array.isArray(usersRef.current) ? usersRef.current.find(u => u.id === userId) : null;
    if (!targetUser) {
      return showMessage('Kullanıcı Bulunamadı', 'Bu masaya bağlı kullanıcı bulunamadı.', 'warning');
    }

    const deskForMessage = (Array.isArray(desksRef.current) ? desksRef.current : []).find(d => d.id === deskId);
    const isGuestRecipient = deskForMessage?.guestOccupant === userId;
    const recipientLabel = isGuestRecipient ? 'Misafir' : 'Ana Kullanıcı';
    const messageInputId = `admin_desk_message_${deskId}_${userId}`;

    const presets = [
      { text: 'Masanız dolu görünüyor ancak masa başında değilsiniz. Lütfen masanıza dönünüz.', level: 'warning' },
      { text: 'Masa kontrolü yapılıyor. Lütfen masanızda olduğunuzu kontrol ediniz.', level: 'info' },
      { text: 'Masanız uzun süredir boş görünüyor. Lütfen masanıza dönün veya masayı sistemden bırakın.', level: 'warning' },
      { text: 'Lütfen masa kullanım kurallarına dikkat ediniz.', level: 'info' }
    ];

    showMessage(
      isGuestRecipient ? 'Misafire Mesaj Gönder' : 'Masa Sahibine Mesaj Gönder',
      <div className="space-y-4">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm space-y-1">
          <p><b>Masa:</b> {deskId}</p>
          <p><b>Kullanıcı Türü:</b> {recipientLabel}</p>
          <p><b>Öğrenci:</b> {targetUser.name}</p>
          <p><b>Kimlik No:</b> {targetUser.identityNo || '-'}</p>
        </div>

        <div>
          <p className="text-xs font-bold text-slate-600 mb-2">Hazır kısa mesajlar</p>
          <div className="space-y-2">
            {presets.map((preset, index) => (
              <button
                key={index}
                type="button"
                onClick={() => sendAdminDeskMessage(deskId, userId, preset.text, 'Yönetici Masa Kontrolü', preset.level)}
                className="w-full text-left p-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl text-sm text-blue-900 transition-colors"
              >
                {preset.text}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <label className="block text-xs font-bold text-slate-600 mb-2">Özel mesaj (en fazla 300 karakter)</label>
          <textarea
            id={messageInputId}
            maxLength={300}
            rows={3}
            placeholder="Örn: Masa dolu görünüyor ancak sizi masada göremedik. Lütfen masanıza dönünüz."
            className="w-full p-3 border border-slate-300 rounded-xl text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById(messageInputId);
              const value = el ? el.value : '';
              sendAdminDeskMessage(deskId, userId, value, 'Yönetici Mesajı', 'warning');
            }}
            className="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md"
          >
            Mesajı Gönder
          </button>
        </div>
      </div>,
      'info'
    );
  };

  // KULLANICI KALICI SİLME:
  // Seçilen kullanıcıları hem yerel state'ten hem Firestore sgmUsers koleksiyonundan siler.
  // Kullanıcı aktif masadaysa, QR bekleyen rezervasyonu varsa veya legacy misafir alanında
  // görünüyorsa ilgili masa da aynı işlemde temizlenir. Tombstone kaydı gecikmiş snapshot'ın
  // silinen kullanıcıyı tekrar ekrana getirmesini engeller.
  const permanentlyDeleteUsers = async (userIds) => {
    const ids = new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean).map(String));
    if (!ids.size) return { deletedCount: 0, failedIds: [] };

    const currentUsers = Array.isArray(usersRef.current) ? usersRef.current : [];
    const existingIds = new Set(currentUsers.filter(u => ids.has(String(u.id))).map(u => String(u.id)));
    if (!existingIds.size) return { deletedCount: 0, failedIds: [] };

    // Snapshot daha geç gelse bile kullanıcı geri görünmesin.
    existingIds.forEach(id => {
      deletedUserIds.add(id);
      rememberDeletedRecordId('users', id);
      pendingUserDeletesRef.current.add(id);
    });
    localStorage.setItem('sgm_pending_user_deletes', JSON.stringify(Array.from(pendingUserDeletesRef.current)));

    // Kullanıcının aktif / bekleyen / legacy misafir masa ilişkilerini tamamen temizle.
    const currentDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
    const nextDesks = currentDesks.map(d => {
      const ownsDesk = existingIds.has(String(d.occupant || ''));
      const hasPending = existingIds.has(String(d.pendingOccupant || ''));
      const isLegacyGuest = existingIds.has(String(d.guestOccupant || ''));
      if (!ownsDesk && !hasPending && !isLegacyGuest) return d;

      const next = { ...d };
      if (ownsDesk) {
        next.status = d.status === 'disabled' ? 'disabled' : 'available';
        next.occupant = null;
        next.ownerDeviceId = null;
        next.sessionStartTime = null;
        next.breakEndTime = null;
        next.reportEndTime = null;
        next.reportIssuedAt = null;
        next.reportVerifiedAt = null;
      }
      if (hasPending) {
        next.pendingOccupant = null;
        next.pendingDeskRole = null;
        next.pendingDeskDeadline = null;
      }
      if (isLegacyGuest) {
        next.guestOccupant = null;
        next.guestSessionStartTime = null;
        next.guestBreakEndTime = null;
        next.guestReported = false;
        next.guestReportEndTime = null;
        next.guestReportIssuedAt = null;
        next.guestReportVerifiedAt = null;
      }
      return next;
    });

    const nextUsers = currentUsers.filter(u => !existingIds.has(String(u.id)));
    usersRef.current = nextUsers;
    desksRef.current = nextDesks;
    setUsers(nextUsers);
    setDesks(nextDesks);
    setSelectedUserIds(prev => prev.filter(id => !existingIds.has(String(id))));

    // Aynı cihazda silinen kullanıcı açıksa oturumunu da kapat.
    if (currentUser?.id && existingIds.has(String(currentUser.id))) {
      sessionStorage.removeItem('sgm_student_session');
      setCurrentUser(null);
      setSelectedDeskId(null);
      setDeskSelectionDeadline(null);
    }

    // Firestore kullanıcı belgelerini doğrudan sil. Başarılı silmeler baseline'dan da çıkarılır.
    const results = await mapLimited(Array.from(existingIds), async id => {
      if (!db) { pendingUserDeletesRef.current.delete(id); return id; }
      if (!fbUser || !adminAuthorized) throw new Error('Yönetici oturumu veya bağlantı bekleniyor.');
      const result = await cloudActions.deleteUser(id, desksRef.current);
      applyCloudRows(result);
      granularBaselineRef.current.users.delete(String(id));
      pendingUserDeletesRef.current.delete(id);
      localStorage.setItem('sgm_pending_user_deletes', JSON.stringify(Array.from(pendingUserDeletesRef.current)));
      return id;
    });

    const failedIds = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const id = Array.from(existingIds)[index];
        failedIds.push(id);
        handleFirestoreQuotaError(result.reason);
      }
    });

    // Masa boşaltmalarını beklemeden Firestore'a gönder. Kullanıcı silme başarısız olsa bile
    // tombstone korunur; sonraki senkron turu kalan silme işlemini tekrar deneyebilir.
    criticalDeskMutationRef.current = true;
    if (db && fbUser && isDataLoaded) {
      persistGranularStateNow({ desks: nextDesks, users: nextUsers }).catch(handleFirestoreQuotaError);
    }

    return { deletedCount: existingIds.size - failedIds.length, failedIds };
  };

  const handleAdminAction = async (action, deskId, userId = null) => {
    const nowTime = Date.now();
    const undoableAdminActions = new Set(['release', 'disable', 'enable', 'cancel_report', 'clear_strike', 'toggle_report_auth', 'toggle_block', 'assign_user', 'regenerate_qr']);
    if (undoableAdminActions.has(action)) {
      const actionLabels = {
        release: 'Masa boşaltma', disable: 'Masayı kullanıma kapatma', enable: 'Masayı kullanıma açma',
        cancel_report: 'Boş bildirimi iptal etme', clear_strike: 'İhlal silme', toggle_report_auth: 'İhbar yetkisi değiştirme',
        toggle_block: 'Kullanıcı engel durumu değiştirme', assign_user: 'Masaya kullanıcı atama', regenerate_qr: 'QR kod yenileme'
      };
      pushUndoSnapshot(actionLabels[action] || 'Yönetici işlemi');
    }
    switch (action) {
      case 'release':
        const releaseDeskData = (Array.isArray(desks) ? desks : []).find(d => d.id === deskId);
        setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === deskId ? { ...d, status: 'available', occupant: null, guestOccupant: null, guestSessionStartTime: null, guestBreakEndTime: null, guestReported: false, guestReportEndTime: null, breakEndTime: null, reportEndTime: null, sessionStartTime: null } : d) : []);
        setUsers(prev => Array.isArray(prev) ? prev.map(u => (u.id === userId || u.id === releaseDeskData?.guestOccupant) ? { ...u, activeDeskId: null, activeDeskRole: null } : u) : []);
        addLog('ADMIN_MÜDAHALE', `Masa ${deskId} yönetici tarafından boşaltıldı.`, deskId, userId);
        break;
      case 'disable':
        const disabledDeskData = (Array.isArray(desks) ? desks : []).find(d => d.id === deskId);
        setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === deskId ? { ...d, status: 'disabled', occupant: null, guestOccupant: null, guestSessionStartTime: null, guestBreakEndTime: null, guestReported: false, guestReportEndTime: null } : d) : []);
        setUsers(prev => Array.isArray(prev) ? prev.map(u => (u.id === userId || u.id === disabledDeskData?.guestOccupant) ? { ...u, activeDeskId: null, activeDeskRole: null } : u) : []);
        addLog('ADMIN_MÜDAHALE', `Masa ${deskId} kullanıma kapatıldı.`, deskId);
        break;
      case 'enable':
        setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === deskId ? { ...d, status: 'available' } : d) : []);
        addLog('ADMIN_MÜDAHALE', `Masa ${deskId} tekrar kullanıma açıldı.`, deskId);
        break;
      case 'cancel_report':
        setDesks(prev => Array.isArray(prev) ? prev.map(d => d.id === deskId ? { ...d, status: 'occupied', reportEndTime: null } : d) : []);
        addLog('ADMIN_MÜDAHALE', `Masa ${deskId} boş bildirimi iptal edildi.`, deskId, userId);
        break;
      case 'clear_strike':
        if (userId) {
          setUsers(prev => Array.isArray(prev) ? prev.map(u => u.id === userId ? { ...u, strikes: Math.max(0, (Number.isFinite(Number(u.strikes)) ? Number(u.strikes) : 0) - 1) } : u) : []);
          addLog('ADMIN_MÜDAHALE', `Kullanıcının 1 ihlali silindi.`, deskId, userId);
        }
        break;
      case 'toggle_report_auth':
        if (userId) {
          const target = usersRef.current.find(u => u.id === userId);
          if (target && !isRestricted(target)) return showMessage('İhbar Yetkisi Açık', 'Kısıtsız hesaplarda boş masa ihbarı açıktır. Moladaki masa ihbar edilemez.', 'info');
          setUsers(prev => Array.isArray(prev) ? prev.map(u => u.id === userId ? { ...u, canReport: u.canReport === false, reportPermissionPolicyVersion: 1, reportPermissionRestrictionUntil: Number(u.restrictedUntil || 0) } : u) : []);
          addLog('ADMIN_YETKI', `Kullanıcının ihbar yetkisi değiştirildi.`, null, userId);
        }
        break;
      
      case 'message_user':
        openAdminDeskMessage(deskId, userId);
        break;
      case 'approve_account': {
        const user = usersRef.current.find(u => u.id === userId);
        if (!user) return showMessage('Hesap Bulunamadı', 'Kullanıcı artık listede bulunmuyor.', 'warning');
        pushUndoSnapshot('Hesap onayı ve kısıt kaldırma');
        try {
          await saveAdminUserChanges(user, {...user, blocked: false, pendingApproval: false,
            restrictedUntil: 0, restrictionReason: '', canReport: true,
            reportPermissionPolicyVersion: 1, reportPermissionRestrictionUntil: 0});
          addLog('ADMIN_HESAP_ONAYLANDI', 'Hesap sorumlu tarafından onaylandı; hesap kısıtı kaldırıldı ve ihbar yetkisi açıldı.', null, userId);
          showMessage('Hesap Onaylandı', 'Onay sunucuya kaydedildi. Öğrenci ekranı güncel hesap durumunu alabilir.', 'success');
        } catch (error) {
          handleFirestoreQuotaError(error);
          showMessage('Onay Kaydedilemedi', error.message, 'warning');
        }
        break;
      }
      case 'toggle_block':
        if (userId) openAdminUserEditor(userId);
        break;
      case 'delete_user':
        if (userId) {
          const userToDelete = (usersRef.current || []).find(u => u.id === userId) || null;
          if (!userToDelete) return showMessage('Kullanıcı Bulunamadı', 'Silinecek kullanıcı artık listede bulunmuyor.', 'warning');

          pushUndoSnapshot('Kullanıcı silme');
          const result = await permanentlyDeleteUsers([userId]);
          if (result.deletedCount > 0) {
            addLog('ADMIN_KULLANICI_SİL', `Öğrenci kaydı Firestore dahil kalıcı olarak silindi.`, null, userId);
            showMessage('Başarılı', 'Kullanıcı kalıcı olarak silindi. Aktif veya bekleyen masası da boşaltıldı.', 'success');
          } else {
            showMessage('Silme Başarısız', 'Kullanıcı Firestore’dan silinemedi. İnternet bağlantısını ve Firebase yetkilerini kontrol edin.', 'danger');
          }
        }
        break;
      case 'assign_user': {
        const rows = usersRef.current || []; const deskRows = desksRef.current || [];
        const target = rows.find(u => u.id === userId); const targetDesk = deskRows.find(d => Number(d.id) === Number(deskId));
        if (!target || target.blocked || isRestricted(target)) return showMessage('Atama Engellendi', 'Önce kullanıcı kısıtını kaldırın ve hesabı onaylayın.', 'warning');
        if (!targetDesk || targetDesk.status !== 'available' || targetDesk.occupant ||
            (targetDesk.pendingOccupant && Number(targetDesk.pendingDeskDeadline) > nowTime && targetDesk.pendingOccupant !== userId)) {
          return showMessage('Atama Engellendi', 'Masa boş ve kullanıma açık olmalıdır.', 'warning');
        }
        if (target.activeDeskId || rows.some(u => u.id !== userId && target.deviceId && u.deviceId === target.deviceId &&
            (u.activeDeskId || Number(u.pendingDeskDeadline || 0) > nowTime))) {
          return showMessage('Atama Engellendi', 'Kullanıcının veya cihazının başka bir aktif masası / rezervasyonu bulunuyor.', 'warning');
        }
        const waited = deskWaitRemaining(target, nowTime);
        if (db) {
          try {
            if (!adminAuthorized) throw new Error('Yönetici yetkisi gerekli.');
            const result = await cloudActions.assign({ userId, deskId });
            applyCloudRows(result);
            addLog('ADMIN_MASA_ATAMA', `Masa ${deskId} yönetici tarafından atandı.${waited ? ' 30 dakikalık bekleme için yönetici istisnası uygulandı.' : ''}`, deskId, userId, false, null, { cooldownOverride: waited > 0 });
            break;
          } catch (error) { handleFirestoreQuotaError(error); return showMessage('Atama Engellendi', error.message, 'warning'); }
        }
        const nextDesks = deskRows.map(d => Number(d.id) === Number(deskId)
          ? { ...d, status: 'occupied', occupant: userId, ownerDeviceId: target.deviceId || null, sessionStartTime: nowTime,
              pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null, breakEndTime: null, reportEndTime: null, reportIssuedAt: null, reportVerifiedAt: null }
          : d.pendingOccupant === userId ? { ...d, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null } : d);
        const nextUsers = rows.map(u => u.id === userId ? { ...u, activeDeskId: deskId, activeDeskRole: 'owner',
          pendingDeskId: null, pendingDeskDeadline: null, lastActiveTime: nowTime,
          deskReclaimAllowedAt: 0, gmDeskAccessAt: Math.max(nowTime, Number(u.gmDeskAccessAt || 0) + 1) } : u);
        criticalDeskMutationRef.current = true; desksRef.current = nextDesks; usersRef.current = nextUsers;
        setDesks(nextDesks); setUsers(nextUsers);
        if (currentUser?.id === userId) { setCurrentUser(nextUsers.find(u => u.id === userId)); setSelectedDeskId(null); setDeskSelectionDeadline(null); }
        addLog('ADMIN_MASA_ATAMA', `Masa ${deskId} yönetici tarafından atandı.${waited ? ' Sistem hatası için 30 dakikalık bekleme kuralına yönetici istisnası uygulandı.' : ''}`, deskId, userId, false, null, { cooldownOverride: waited > 0 });
        break;
      }
      case 'regenerate_qr':
        const newQR = 'QR-' + deskId + '-' + generateId();
        const updatedQrDesks = (desksRef.current || []).map(d => Number(d.id) === Number(deskId) ? { ...d, qrCode: newQR } : d);
        desksRef.current = updatedQrDesks;
        criticalDeskMutationRef.current = true;
        setDesks(updatedQrDesks);
        addLog('ADMIN_MÜDAHALE', `Masa ${deskId} QR kodu yenilendi.`, deskId);
        showMessage("Başarılı", "Masanın QR kodu yenilendi.", "success");
        break;
    }
  };

  const openAdminUserEditor = (userId) => {
    const user = (Array.isArray(users) ? users : []).find(u => u.id === userId);
    if (!user) return showMessage("Kullanıcı Bulunamadı", "Seçilen öğrenci kaydı bulunamadı.", "warning");

    setLiveDeskId(null);
    setAdminUserEditId(userId);
    setModal({
      isOpen: true,
      type: 'info',
      title: `${user.name || 'Öğrenci'} • Kullanıcı Bilgileri`,
      content: null,
      onClose: () => {
        setAdminUserEditId(null);
        setModal({ isOpen: false, type: '', title: '', content: null, onClose: null });
      }
    });
  };

  const renderAdminUserEditorContent = (userId) => {
    const safeUsers = Array.isArray(users) ? users : [];
    const user = safeUsers.find(u => u.id === userId);

    if (!user) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-red-600 font-semibold">Bu öğrenci kaydı artık sistemde bulunmuyor.</p>
          <button onClick={() => { setAdminUserEditId(null); closeMessage(); }} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold">
            Kapat
          </button>
        </div>
      );
    }

    const currentStrikeCount = Number.isFinite(Number(user.strikes)) ? Math.max(0, Number(user.strikes)) : 0;

    return (
      <div className="space-y-5">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-start gap-3">
            <User className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-blue-900">{user.name || 'Öğrenci'}</p>
              <p className="text-xs text-blue-700 mt-1">
                Öğrencinin giriş bilgilerini ve günlük ihlal cezasını buradan görüntüleyip değiştirebilirsiniz.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs font-semibold text-slate-600">Son 7 gündeki ihlal: {(user.violationHistory || []).filter(t => t > Date.now()-WEEK_MS).length}</p>
        <form
          key={`admin-user-edit-${user.id}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);

            const newName = String(formData.get('editName') || '').trim();
            const newPhone = cleanIdentityFormat(formData.get('editSpecialCode'));
            const newPin = cleanPinFormat(formData.get('editPin'));
            const parsedStrikes = parseInt(formData.get('editStrikes'), 10);
            const newStrikes = Number.isFinite(parsedStrikes) ? Math.max(0, parsedStrikes) : 0;
            const restrictionDays = Math.max(0, Number(formData.get('restrictionDays') || 0));
            const newBlocked = false;
            const newCanReport = formData.get('editCanReport') === 'on';

            if (!newName) return showMessage("Bilgi Eksik", "Ad soyad boş bırakılamaz.", "warning");
            if (newPhone.length !== 8) return showMessage("GM Özel Kod Hatalı", "GM Özel Kod 8 rakamdan oluşmalıdır.", "warning");
            if (newPin.length !== 8 || !/^\d{8}$/.test(newPin)) return showMessage("Şifre Hatalı", "Öğrenci giriş şifresi 8 rakamdan oluşmalıdır.", "warning");

            const duplicatePhone = safeUsers.some(
              u => u.id !== user.id && cleanIdentityFormat(u.specialCode) === newPhone
            );
            if (duplicatePhone) return showMessage("Kod Kullanılıyor", "Bu GM Özel Kod başka bir öğrenciye kayıtlı.", "warning");

            if (isRestricted(user) && (newPhone !== user.specialCode || newPin !== user.pin)) return showMessage('İşlem Engellendi', 'Kısıtlı kişinin GM Özel Kod ve şifresi değiştirilemez; önce mevcut hesabın kısıtını kaldırın.', 'warning');
            const updatedUser = {
              ...user,
              name: newName,
              specialCode: newPhone,
              pin: newPin,
              strikes: newStrikes,
              blocked: newBlocked,
              pendingApproval: formData.get("approveAccount") === "on" ? false : user.pendingApproval === true,
              restrictedUntil: restrictionDays > 0 ? Date.now() + restrictionDays * 86400000 : 0,
              restrictionReason: restrictionDays > 0 ? 'Yönetici tarafından süreli kısıtlama' : '',
              canReport: newCanReport
            };
            // Onay/engel/süreli kısıt kalktığı anda ihbar yetkisini de aç.
            if (!isRestricted(updatedUser)) updatedUser.canReport = true;
            if (!isRestricted(updatedUser)) {
              updatedUser.reportPermissionPolicyVersion = 1;
              updatedUser.reportPermissionRestrictionUntil = Number(updatedUser.restrictedUntil || 0);
            }

            pushUndoSnapshot('Kullanıcı bilgilerini düzenleme');
            try {
              await saveAdminUserChanges(user, updatedUser);
            } catch (error) {
              handleFirestoreQuotaError(error);
              return showMessage('Hesap Kaydedilemedi', error.message, 'warning');
            }

            addLog(
              'ADMIN_KULLANICI_GUNCELLE',
              `${newName} adlı öğrencinin kullanıcı bilgileri yönetici tarafından güncellendi. Günlük ihlal: ${currentStrikeCount} → ${newStrikes}.`,
              user.activeDeskId || null,
              user.id
            );

            setAdminUserEditId(null);
            closeMessage();
            setTimeout(() => showMessage("Kaydedildi", "Öğrenci bilgileri ve ihlal cezası başarıyla güncellendi.", "success"), 100);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Ad Soyad</label>
            <input type="text" name="editName" defaultValue={user.name || ''} required className="w-full p-3 border border-slate-300 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">GM Özel Kodunuz</label>
            <input type="text" inputMode="numeric" minLength={8} maxLength={8} name="editSpecialCode" defaultValue={user.specialCode || ''} required className="w-full p-3 border border-slate-300 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Sisteme Giriş Şifresi</label>
            <div className="relative">
              <input type="text" name="editPin" defaultValue={user.pin || ''} required minLength={8} maxLength={8} className="w-full p-3 pr-12 border border-indigo-300 rounded-xl bg-indigo-50 font-mono font-black tracking-[0.25em] text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <Eye className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-500 pointer-events-none" />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">GM Özel Kod ile birlikte sisteme girerken kullanılan 8 haneli şifredir.</p>
          </div>

          <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <label className="block text-sm font-black text-red-800">Günlük İhlal Cezası</label>
                <p className="text-[11px] text-red-600 mt-0.5">Mevcut ihlal sayısını değiştirebilir veya hızlı işlemleri kullanabilirsiniz.</p>
              </div>
              <span className="px-3 py-1 bg-white border border-red-200 rounded-lg text-red-700 font-black">{currentStrikeCount}</span>
            </div>

            <input type="number" min="0" step="1" name="editStrikes" defaultValue={currentStrikeCount} className="w-full p-3 border border-red-300 rounded-xl bg-white font-bold text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={currentStrikeCount <= 0}
                onClick={() => {
                  if (currentStrikeCount <= 0) return;
                  setUsers(prev => Array.isArray(prev)
                    ? prev.map(u => u.id === user.id ? { ...u, strikes: Math.max(0, (Number(u.strikes) || 0) - 1) } : u)
                    : []
                  );
                  setCurrentUser(prev => prev && prev.id === user.id ? { ...prev, strikes: Math.max(0, (Number(prev.strikes) || 0) - 1) } : prev);
                  addLog('ADMIN_MÜDAHALE', `${user.name} adlı kullanıcının 1 günlük ihlali silindi.`, user.activeDeskId || null, user.id);
                }}
                className="py-2.5 bg-yellow-100 hover:bg-yellow-200 disabled:opacity-40 disabled:cursor-not-allowed text-yellow-800 rounded-xl font-bold text-sm"
              >
                1 İhlal Sil
              </button>

              <button
                type="button"
                disabled={currentStrikeCount <= 0}
                onClick={() => {
                  if (currentStrikeCount <= 0) return;
                  setUsers(prev => Array.isArray(prev) ? prev.map(u => u.id === user.id ? { ...u, strikes: 0 } : u) : []);
                  setCurrentUser(prev => prev && prev.id === user.id ? { ...prev, strikes: 0 } : prev);
                  addLog('ADMIN_MÜDAHALE', `${user.name} adlı kullanıcının günlük ihlalleri sıfırlandı.`, user.activeDeskId || null, user.id);
                }}
                className="py-2.5 bg-red-100 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed text-red-700 rounded-xl font-bold text-sm"
              >
                Tümünü Sıfırla
              </button>
            </div>

            <p className="text-[11px] text-slate-500">
              Bu alan günlük ihlal sayacını değiştirir. Geçmiş olay kayıtları “İhlal Kayıtları” bölümünde kayıt olarak kalır.
            </p>
          </div>

          {user.pendingApproval && <label className="block p-3 bg-amber-50 border rounded-xl"><input type="checkbox" name="approveAccount" /> Gerekli kontrolleri yaptım, hesabı onayla</label>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block p-3 bg-slate-50 border rounded-xl">
              <span className="font-bold">Süreli kısıtlama (gün)</span>
              <input name="restrictionDays" type="number" min="0" step="1" defaultValue={Number(user.restrictedUntil || 0) > Date.now() ? Math.ceil((user.restrictedUntil-Date.now())/86400000) : 0} className="w-full p-2 border rounded-lg mt-2" />
              <span className="text-xs">0: Kısıtlamayı kaldır. Bitiş: {user.pendingApproval ? 'Sorumlu onayı bekleniyor' : Number(user.restrictedUntil || 0) > Date.now() ? new Date(user.restrictedUntil).toLocaleString('tr-TR') : 'Aktif'}</span>
            </label>

            <label className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
              <span>
                <span className="block text-sm font-bold text-slate-700">İhbar Yetkisi</span>
                <span className="block text-[11px] text-slate-500">{user.canReport !== false ? 'Şu an açık' : 'Şu an kapalı'}</span>
              </span>
              <input type="checkbox" name="editCanReport" defaultChecked={user.canReport !== false} className="w-5 h-5 accent-green-600" />
            </label>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
            <div><b>Aktif Masa:</b> {user.activeDeskId ? `Masa ${user.activeDeskId}` : 'Yok'}</div>
            <div><b>GM Özel Kod:</b> {user.specialCode || "-"}</div>
            <div><b>Kullanıcı ID:</b> <span className="font-mono">{user.id}</span></div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button type="button" onClick={() => { setAdminUserEditId(null); closeMessage(); }} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold">
              Vazgeç
            </button>
            <button type="submit" disabled={adminUserSavingId === user.id} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold shadow-md flex items-center justify-center gap-2">
              <Save className="w-4 h-4" /> Değişiklikleri Kaydet
            </button>
          </div>
        </form>
      </div>
    );
  };

  const renderAdminDeskContent = (deskId) => {
    const safeDesks = Array.isArray(desks) ? desks : [];
    const liveDesk = safeDesks.find(d => Number(d.id) === Number(deskId));
    if (!liveDesk) return null;
    const safeUsers = Array.isArray(users) ? users : [];
    const occupant = liveDesk.occupant ? safeUsers.find(u => u.id === liveDesk.occupant) : null;
    const guestOccupant = liveDesk.guestOccupant ? safeUsers.find(u => u.id === liveDesk.guestOccupant) : null;
    
    const getStatusDisplay = () => {
       switch(liveDesk.status) {
            case 'available': return <span className="px-3 py-1 bg-green-100 text-green-700 rounded-lg font-black text-sm uppercase tracking-wide">Boşta</span>;
            case 'occupied': return <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg font-black text-sm uppercase tracking-wide">Öğrenci Masada</span>;
            case 'on_break': return <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-lg font-black text-sm uppercase tracking-wide">Molada / Dışarıda</span>;
            case 'reported': return <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-lg font-black text-sm uppercase tracking-wide animate-pulse">İhbar Edildi (Kontrol)</span>;
            case 'disabled': return <span className="px-3 py-1 bg-slate-200 text-slate-700 rounded-lg font-black text-sm uppercase tracking-wide">Kullanıma Kapalı</span>;
            default: return 'Bilinmiyor';
       }
    };

    return (
        <div className="space-y-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="mb-3 flex items-center gap-2"><strong>Durum:</strong> {getStatusDisplay()}</div>
            {occupant && (
              <>
                <p className="mt-2 text-blue-700"><strong>Kullanıcı:</strong> {occupant.name} (GM: {occupant.specialCode})</p>
                <p><strong>Başlangıç:</strong> {formatDateTime(liveDesk.sessionStartTime)}</p>
                <p><strong>Kalan Molalar:</strong> {occupant.breaks?.short} Kısa, {occupant.breaks?.long} Uzun</p>
                <p className="text-red-600"><strong>İhlal Sayısı:</strong> {Number.isFinite(Number(occupant.strikes)) ? Number(occupant.strikes) : 0} / 2</p>
              </>
            )}
          </div>
          
          <div className="flex flex-col items-center justify-center p-4 bg-white border border-slate-200 rounded-xl shadow-sm relative">
             <button onClick={() => { closeMessage(); setTimeout(() => handleAdminAction('regenerate_qr', liveDesk.id), 200); }} className="absolute top-2 right-2 p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors shadow-sm" title="QR Kodunu Yenile"><RefreshCw className="w-4 h-4"/></button>
             <p className="text-sm font-bold text-slate-600 mb-1">Masa {liveDesk.id} QR Kodu</p>
             <p className="text-xs text-slate-400 mb-3">Bu QR kod öğrencinin seçtiği masayı doğrulamak için kullanılır.</p>
             {liveDesk.qrCode ? (
               <>
                 <img
                   src={getDeskQrImageUrl(liveDesk, 300)}
                   alt={`Masa ${liveDesk.id} QR`}
                   className="w-44 h-44 rounded-lg shadow-sm mb-3 border border-slate-200 bg-white p-2"
                 />
                 <p className="text-[10px] text-slate-500 font-mono break-all bg-slate-50 px-2 py-1 rounded w-full text-center border border-slate-200">{liveDesk.qrCode}</p>
                 <button
                   type="button"
                   onClick={() => handleDownloadDeskQR(liveDesk)}
                   className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                 >
                   <QrCode className="w-4 h-4"/> Bu Masanın QR'ını İndir
                 </button>
               </>
             ) : (
               <div className="w-full p-4 bg-amber-50 border border-amber-200 rounded-xl text-center">
                 <p className="text-sm font-bold text-amber-800">Bu masaya ait QR kod bulunamadı.</p>
                 <button
                   type="button"
                   onClick={() => { closeMessage(); setTimeout(() => handleAdminAction('regenerate_qr', liveDesk.id), 200); }}
                   className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-sm"
                 >
                   QR Kod Oluştur
                 </button>
               </div>
             )}
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-4">
            {liveDesk.status === 'available' && (
               <div className="col-span-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-2">
                 <p className="text-xs font-bold text-blue-800 mb-2">Öğrenci Ata (Manuel Düzenleme)</p>
                 <div className="flex gap-2">
                   <select id={`assign_user_${liveDesk.id}`} className="flex-1 p-2 rounded border border-blue-300 text-sm bg-white">
                      <option value="">Öğrenci Seçin...</option>
                      {safeUsers.filter(u => !u.activeDeskId && !u.blocked && !isRestricted(u)).map(u => (
                         <option key={u.id} value={u.id}>{u.name} • GM Özel Kod: {u.specialCode}{deskWaitRemaining(u) > 0 ? " • 30 dk bekleme: yönetici atayabilir" : ""}</option>
                      ))}
                   </select>
                   <button onClick={() => {
                      const uid = document.getElementById(`assign_user_${liveDesk.id}`).value;
                      if(uid) { handleAdminAction('assign_user', liveDesk.id, uid); closeMessage(); setLiveDeskId(null); }
                   }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-sm shadow">Ata</button>
                 </div>
               </div>
            )}
            {liveDesk.status !== 'available' && liveDesk.status !== 'disabled' && (
               <button onClick={() => handleAdminAction('release', liveDesk.id, liveDesk.occupant)} className="p-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-semibold">Masayı Boşalt</button>
            )}
            {liveDesk.status === 'reported' && (
               <button onClick={() => handleAdminAction('cancel_report', liveDesk.id, liveDesk.occupant)} className="p-2 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg text-sm font-semibold">İhbarı İptal Et</button>
            )}
            {liveDesk.status === 'disabled' ? (
               <button onClick={() => handleAdminAction('enable', liveDesk.id)} className="p-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-bold shadow-md">Kullanıma Aç</button>
            ) : (
               <button onClick={() => handleAdminAction('disable', liveDesk.id, liveDesk.occupant)} className="p-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-lg text-sm font-semibold">Kullanıma Kapat</button>
            )}
            {occupant && occupant.strikes > 0 && (
               <button onClick={() => handleAdminAction('clear_strike', liveDesk.id, occupant.id)} className="p-2 bg-yellow-100 text-yellow-700 hover:bg-yellow-200 rounded-lg text-sm font-semibold">1 İhlal Sil</button>
            )}
             
             {occupant && (
               <button onClick={() => handleAdminAction('message_user', liveDesk.id, occupant.id)} className="p-2 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg text-sm font-semibold border border-blue-300 flex items-center justify-center gap-1">
                 <Smartphone className="w-4 h-4"/> Mesaj Gönder
               </button>
             )}

          </div>
          
          <button onClick={() => { closeMessage(); setLiveDeskId(null); }} className="w-full mt-2 p-3 bg-slate-800 text-white hover:bg-slate-900 rounded-xl font-bold shadow-md transition-colors">Vazgeç / Geri Dön</button>
        </div>
    );
  };

  const safeUsersList = Array.isArray(users) ? users : [];
  const myUserObj = currentUser ? safeUsersList.find(u => u.id === currentUser.id) : null;
  const safeDesksList = Array.isArray(desks) ? desks : [];
  
  const myDesk = myUserObj && myUserObj.activeDeskId ? safeDesksList.find(d => d.id === myUserObj.activeDeskId) : null;
  const studentRestricted = !myUserObj || myUserObj.blocked || isRestricted(myUserObj, now);
  const studentDeskWait = deskWaitRemaining(myUserObj, now);
  const filteredUsers = safeUsersList.filter(u => !userSearch.trim() || [u.name, u.specialCode, u.pin].some(value => String(value || '').toLocaleLowerCase('tr-TR').includes(userSearch.trim().toLocaleLowerCase('tr-TR'))));
  const visibleLogs = [...new Map([...archivedLogs, ...(Array.isArray(logs) ? logs : [])].filter(l => !isRecordDeleted('logs', l.id)).map(l => [l.id, l])).values()].sort((a,b) => b.time - a.time);
  const myDeskRole = myUserObj?.activeDeskRole || (myDesk?.guestOccupant === currentUser?.id ? 'guest' : 'owner');
  const myIsGuest = myDeskRole === 'guest';
  const myIsReported = myIsGuest ? myDesk?.guestReported === true : myDesk?.status === 'reported';
  const myReportEndTime = myIsGuest ? myDesk?.guestReportEndTime : myDesk?.reportEndTime;
  const myBreakEndTime = myIsGuest ? myDesk?.guestBreakEndTime : myDesk?.breakEndTime;
  const myIsOnBreak = myIsGuest ? !!myDesk?.guestBreakEndTime : myDesk?.status === 'on_break';

  const createEightDigitCode = (used = new Set()) => {
    if(used.size>=90000000) throw new Error('Kimlik alanı doldu.');
    while(true) {
      const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);
      if(bytes[0]>=4230000000) continue;
      const code=String(10000000+bytes[0]%90000000);
      if(!used.has(code))return code;
    }
  };

  const pushUndoSnapshot = (label) => {
    const snapshot = {
      id: `UNDO-${Date.now()}-${generateId()}`,
      label,
      tab: adminTab,
      time: Date.now(),
      settings: JSON.parse(JSON.stringify(settings || {})),
      layoutElements: JSON.parse(JSON.stringify(Array.isArray(layoutElements) ? layoutElements : [])),
      users: JSON.parse(JSON.stringify(Array.isArray(usersRef.current) ? usersRef.current : [])),
      logs: JSON.parse(JSON.stringify(Array.isArray(logsRef.current) ? logsRef.current : [])),
      archivedLogs: JSON.parse(JSON.stringify(archivedLogs)),
      violationRecords: JSON.parse(JSON.stringify(Array.isArray(violationRecordsRef.current) ? violationRecordsRef.current : [])),
      feedbackRecords: JSON.parse(JSON.stringify(Array.isArray(feedbackRecordsRef.current) ? feedbackRecordsRef.current : [])),
      desks: JSON.parse(JSON.stringify(Array.isArray(desksRef.current) ? desksRef.current : []))
    };
    setUndoStack(prev => [snapshot, ...prev].slice(0, 20));
  };

  const getCurrentTabUndoSnapshot = () => undoStack.find(item => item?.tab === adminTab) || null;

  const undoLastAdminOperation = async () => {
    const snapshot = getCurrentTabUndoSnapshot();
    if (!snapshot) return showMessage('Geri Alınacak İşlem Yok', 'Bu sekmede henüz geri alınabilecek bir yönetici işlemi bulunmuyor.', 'warning');
    if (db && (!fbUser || !adminAuthorized || !navigator.onLine)) return showMessage('Geri Alınamadı', 'Yönetici bağlantısı kurulunca yeniden deneyin.', 'warning');
    if (db && fbUser) {
      try {
        await appendChainRef.current;
        const historyToRestore = [
          ...[...snapshot.logs, ...(snapshot.archivedLogs || [])].filter(row => isRecordDeleted('logs', row.id)).map(row => ['sgmAudit', 'logs', row]),
          ...snapshot.violationRecords.filter(row => isRecordDeleted('violations', row.id)).map(row => ['sgmViolations', 'violations', row]),
          ...snapshot.feedbackRecords.filter(row => isRecordDeleted('feedback', row.id)).map(row => ['sgmFeedback', 'feedback', row])
        ];
        const historyResults = await mapLimited(historyToRestore, ([bucket, kind, row]) => runTransaction(db, async tx => {
          const marker = getLiveDoc('sgmDeletedRecords', `${kind}-${row.id}`);
          await tx.get(marker); tx.delete(marker); tx.set(getLiveDoc(bucket, row.id), row);
        }));
        if (historyResults.some(result => result.status === 'rejected')) throw new Error('Kayıtların geri alınması sunucuya kaydedilemedi.');
        for (const [bucket, kind, row] of historyToRestore) {
          delete readAppendOutbox()[`${bucket}/${row.id}`];
          if (kind === 'logs') delete readAppendOutbox()[`sgmLogs/${row.id}`];
        }
        saveAppendOutbox();
        const restored = snapshot.users.filter(user => isRecordDeleted('users', user.id) || serverDeletedUserIdsRef.current.has(String(user.id)));
        const results = await mapLimited(restored, user => runTransaction(db, async tx => {
          const target = getLiveDoc('sgmUsers', user.id), marker = getLiveDoc('sgmDeletedUsers', user.id);
          await tx.get(marker);
          tx.delete(marker); tx.set(target, user);
        }));
        if (results.some(result => result.status === 'rejected')) throw new Error('Geri alma sunucuya kaydedilemedi.');
        restored.forEach(user => { pendingUserDeletesRef.current.delete(String(user.id)); serverDeletedUserIdsRef.current.delete(String(user.id)); });
        localStorage.setItem('sgm_pending_user_deletes', JSON.stringify(Array.from(pendingUserDeletesRef.current)));
      } catch (error) { handleFirestoreQuotaError(error); return showMessage('Geri Alınamadı', error.message, 'warning'); }
    }
    restoreDeletedRecordProtectionFromSnapshot(snapshot);
    if (snapshot.settings) setSettings(snapshot.settings);
    if (Array.isArray(snapshot.layoutElements)) setLayoutElements(snapshot.layoutElements);
    snapshot.users.forEach(u=>deletedUserIds.delete(u.id));
    setUsers(snapshot.users); usersRef.current = snapshot.users;
    setLogs(snapshot.logs); logsRef.current = snapshot.logs;
    setArchivedLogs(snapshot.archivedLogs || []);
    setViolationRecords(snapshot.violationRecords); violationRecordsRef.current = snapshot.violationRecords;
    setFeedbackRecords(snapshot.feedbackRecords); feedbackRecordsRef.current = snapshot.feedbackRecords;
    setDesks(snapshot.desks); desksRef.current = snapshot.desks;
    setUndoStack(prev => prev.filter(item => item.id !== snapshot.id));
    setSelectedUserIds([]); setSelectedLogIds([]); setSelectedViolationIds([]); setSelectedFeedbackIds([]);
    addLog('ADMIN_GERI_AL', `${snapshot.label} işlemi geri alındı.`);
    showMessage('İşlem Geri Alındı', `${snapshot.label} işlemi öncesindeki durum geri yüklendi.`, 'success');
  };

  const createAutomaticUser = async () => {
    if (adminCreatingUser) return;
    const name = window.prompt('Yeni kişinin gerçek adını ve soyadını yazın:');
    if (!name?.trim()) return;
    const current = usersRef.current || [];
    if (current.some(u => cleanNameFormat(u.name) === cleanNameFormat(name))) return showMessage('Kayıt Zaten Var', 'Bu kişi için yeniden GM Özel Kod oluşturulamaz. Mevcut kaydı kontrol edin.', 'warning');
    setAdminCreatingUser(true);
    try {
      pushUndoSnapshot('Yeni kullanıcı oluşturma');
      let newUser;
      if (db) {
        if (!auth) throw new Error('Firebase yönetici oturumu bulunamadı.');
        await ensureTabAuthPersistence(); await auth.authStateReady();
        const adminUser = auth.currentUser;
        if (!adminUser) throw new Error('Yönetici paneline yeniden giriş yapın.');
        const tokenResult = await adminUser.getIdTokenResult(true);
        if (tokenResult.claims.admin !== true) throw new Error('Yönetici yetkisi gerekli.');
        if (!adminCreateRequestRef.current || adminCreateRequestRef.current.name !== name.trim()) {
          adminCreateRequestRef.current = {name: name.trim(), requestId: crypto.randomUUID ? crypto.randomUUID() : 'ADMIN-' + Date.now() + '-' + generateId()};
        }
        const response = await fetch('/api/admin-student-create', {
          method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${tokenResult.token}`},
          body: JSON.stringify(adminCreateRequestRef.current)
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok !== true || !payload.user?.id) throw new Error(payload?.message || `Hesap servisi HTTP ${response.status} döndürdü.`);
        if (auth.currentUser?.uid !== adminUser.uid) throw new Error('Hesap kaydedildi ancak yönetici oturumu değişti. Yönetici panelinden listeyi kontrol edin.');
        newUser = payload.user;
        granularBaselineRef.current.users.set(String(newUser.id), newUser);
      } else {
        const localRows = usersRef.current || [];
        const identityNo = createEightDigitCode(new Set(localRows.map(u => u.identityNo)));
        const pin = createEightDigitCode(new Set(localRows.map(u => u.pin)));
        const specialCode = createEightDigitCode(new Set(localRows.map(u => u.specialCode)));
        newUser = {id: 'U' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + generateId()), name: name.trim(), identityNo, pin, specialCode,
          pendingApproval: true, restrictionReason: 'Sorumlu onayı bekleniyor', restrictedUntil: 0,
          activeDeskId: null, breaks: {short: settings.shortBreakCount, long: settings.longBreakCount}, strikes: 0, blocked: false, canReport: true};
        pendingUserCreatesRef.current.add(String(newUser.id));
      }
      // Yeni hesap ayrı kimlikle eklenir; mevcut hesapların üstüne yazılmaz.
      const latest = usersRef.current || [];
      usersRef.current = [...latest.filter(u => u.id !== newUser.id), newUser]; setUsers(usersRef.current);
      localStorage.setItem('sgm_users', JSON.stringify(usersRef.current));
      adminCreateRequestRef.current = null;
      addLog('ADMIN_KULLANICI_OLUSTUR', 'Yeni kullanıcı ayrı kimlikle oluşturuldu; hesap onay bekliyor.', null, newUser.id);
      showMessage('Bilgilerinizi Kaydedin', `GM Özel Kod: ${newUser.specialCode}\nŞifre: ${newUser.pin}\nKütüphane sorumlumuz ile iletişime geçin.`, 'success');
    } catch (error) {
      handleFirestoreQuotaError(error);
      showMessage('Hesap Oluşturulamadı', error.message, 'warning');
    } finally { setAdminCreatingUser(false); }
  };

  const bulkUserAction = async (action) => {
    if (!selectedUserIds.length) return showMessage('Seçim Yok', 'Önce en az bir kullanıcı seçin.', 'warning');

    const ids = new Set(selectedUserIds.map(String));
    const current = Array.isArray(usersRef.current) ? usersRef.current : [];

    if (action === 'delete') {
      const selectedExisting = current.filter(u => ids.has(String(u.id)));
      if (!selectedExisting.length) return showMessage('Seçim Yok', 'Seçilen kullanıcılar artık listede bulunmuyor.', 'warning');

      pushUndoSnapshot('Toplu kullanıcı silme');
      const result = await permanentlyDeleteUsers(selectedExisting.map(u => u.id));
      setSelectedUserIds([]);

      if (result.failedIds.length) {
        addLog('ADMIN_TOPLU_KULLANICI', `${result.deletedCount} kullanıcı silindi; ${result.failedIds.length} kullanıcı Firestore silme hatası nedeniyle beklemede.`);
        return showMessage('Kısmen Tamamlandı', `${result.deletedCount} kullanıcı kalıcı olarak silindi. ${result.failedIds.length} kayıt Firestore'dan silinemedi; bağlantı/kota düzeldikten sonra tekrar deneyin.`, 'warning');
      }

      addLog('ADMIN_TOPLU_KULLANICI', `${result.deletedCount} kullanıcı Firestore dahil kalıcı olarak silindi.`);
      return showMessage('Başarılı', `${result.deletedCount} kullanıcı kalıcı olarak silindi. Aktif ve bekleyen masa bağlantıları temizlendi.`, 'success');
    }

    pushUndoSnapshot('Toplu kullanıcı işlemi');
    let next = current;
    if (action === 'block') next = current.map(u => ids.has(String(u.id)) ? { ...u, blocked: false, restrictedUntil: Date.now() + Math.max(1, Number(bulkRestrictionDays) || 5) * 86400000, restrictionReason: 'Yönetici tarafından toplu süreli kısıtlama' } : u);
    else if (action === 'unblock') next = current.map(u => ids.has(String(u.id)) ? { ...u, blocked: false, pendingApproval: false, restrictedUntil: 0, restrictionReason: '', canReport: true, reportPermissionPolicyVersion: 1, reportPermissionRestrictionUntil: 0 } : u);

    if (db) {
      try {
        for (const desired of next.filter(u => ids.has(String(u.id)))) {
          const original = current.find(u => u.id === desired.id);
          await saveAdminUserChanges(original, desired);
        }
      } catch (error) {
        handleFirestoreQuotaError(error);
        return showMessage('Toplu İşlem Tamamlanamadı', 'Tamamlanan hesaplar kaydedildi; kalanlar için tekrar deneyin. ' + error.message, 'warning');
      }
    } else {
      usersRef.current = next;
      setUsers(next);
    }
    setSelectedUserIds([]);
    addLog('ADMIN_TOPLU_KULLANICI', `${ids.size} kullanıcı için ${action} toplu işlemi uygulandı.`);
  };

  const reportSettingsRepairBusyRef = useRef(false);
  useEffect(() => {
    if (!db || !adminDataMode || !fbUser || !isDataLoaded || settings.reportsEnabled !== false || reportSettingsRepairBusyRef.current) return;
    reportSettingsRepairBusyRef.current = true;
    const enable = async () => {
      try {
        const next = await runTransaction(db, async tx => {
          const ref = getLiveSettingsDoc(), snapshot = await tx.get(ref);
          const remote = {...DEFAULT_SETTINGS, ...(snapshot.data() || {})};
          if (remote.reportsEnabled === false) tx.set(ref, {reportsEnabled: true}, {merge: true});
          return {...remote, reportsEnabled: true};
        });
        granularBaselineRef.current.settings = stableJson(next);
        settingsRef.current = next; setSettings(next);
        addLog('ADMIN_IHBAR_SISTEM_ACILDI', 'Boş masa ihbarı sistem genelinde açıldı. Moladaki masalar ihbar edilemez.');
      } catch (error) { handleFirestoreQuotaError(error); }
      finally { reportSettingsRepairBusyRef.current = false; }
    };
    enable();
  }, [adminDataMode, fbUser, isDataLoaded, settings.reportsEnabled, Math.floor(now / 15000)]);

  const reportPermissionRepairBusyRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded || (db && (!adminDataMode || !fbUser || !navigator.onLine || !granularLoadedRef.current.users)) || reportPermissionRepairBusyRef.current) return;
    const candidates = (usersRef.current || []).filter(user => shouldRestoreReportPermission(user));
    if (!candidates.length) return;
    reportPermissionRepairBusyRef.current = true;
    const restore = async () => {
      try {
        for (const candidate of candidates) {
          const restoreTime = Date.now();
          const patchFor = user => ({
            canReport: true,
            reportPermissionPolicyVersion: 1,
            reportPermissionRestrictionUntil: Number(user.restrictedUntil || 0),
            reportPermissionRestoredAt: restoreTime
          });
          const result = db ? await runTransaction(db, async tx => {
            const userRef = getLiveDoc('sgmUsers', candidate.id);
            const snapshot = await tx.get(userRef);
            if (!snapshot.exists()) return null;
            const user = { ...snapshot.data(), id: candidate.id };
            if (!shouldRestoreReportPermission(user)) return null;
            const patch = patchFor(user);
            tx.set(userRef, patch, { merge: true });
            return { ...user, ...patch };
          }) : (() => {
            const user = usersRef.current.find(u => u.id === candidate.id);
            return user && shouldRestoreReportPermission(user) ? {...user, ...patchFor(user)} : null;
          })();
          if (!result) continue;
          applyCloudRows({ user: result });
          addLog('ADMIN_IHBAR_YETKISI_ACILDI', 'Hesap kısıtı bulunmayan öğrencinin ihbar yetkisi açıldı.', null, result.id);
        }
      } catch (error) { handleFirestoreQuotaError(error); }
      finally { reportPermissionRepairBusyRef.current = false; }
    };
    restore();
  }, [isDataLoaded, adminDataMode, fbUser, users, Math.floor(now / 15000)]);

  const bulkDeleteRecords = (kind) => {
    const config = {
      logs: [selectedLogIds, logsRef, setLogs, setSelectedLogIds],
      violations: [selectedViolationIds, violationRecordsRef, setViolationRecords, setSelectedViolationIds],
      feedback: [selectedFeedbackIds, feedbackRecordsRef, setFeedbackRecords, setSelectedFeedbackIds]
    }[kind];
    if (!config || !config[0].length) return showMessage('Seçim Yok', 'Önce silmek istediğiniz kayıtları seçin.', 'warning');
    pushUndoSnapshot('Toplu kayıt silme');
    const [selected, ref, setter, clear] = config; const ids = new Set(selected);
    const bucket = kind === 'violations' ? 'violations' : kind === 'feedback' ? 'feedback' : 'logs';
    selected.forEach(id => rememberDeletedRecordId(bucket, id));
    if (kind !== 'logs') deleteHistoryRecords(bucket, selected);
    const next = (Array.isArray(ref.current) ? ref.current : []).filter(x => !ids.has(x.id));
    if (kind === 'logs') { setArchivedLogs(prev => prev.filter(x => !ids.has(x.id))); deleteArchivedLogIds(selected); }
    ref.current = next; setter(next); clear([]);
    addLog('ADMIN_TOPLU_SILME', `${ids.size} adet ${kind} kaydı toplu olarak silindi.`);
  };

  const handleExportUsers = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(users, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `sgm_ogrenciler_${new Date().toLocaleDateString('tr-TR')}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    addLog('SİSTEM_YEDEK', 'Kullanıcı listesi JSON formatında yedek olarak indirildi.');
  };

  const deleteSystemLog = (log) => {
    if (!log?.id) return;

    showMessage(
      'Kaydı Sil',
      <div className="space-y-4">
        <p className="text-sm text-slate-700">Bu sistem kaydını silmek istediğinize emin misiniz?</p>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
          <div><b>İşlem:</b> {String(log.type || 'KAYIT').replace(/_/g, ' ')}</div>
          <div className="mt-1"><b>Tarih:</b> {new Date(log.time || Date.now()).toLocaleString('tr-TR')}</div>
          <div className="mt-1"><b>Açıklama:</b> {log.message || '-'}</div>
        </div>
        <p className="text-xs text-red-600 font-semibold">Silinen kayıt, Kayıtlar listesinden ve senkronize veriden kaldırılır.</p>
        <div className="flex gap-3">
          <button onClick={closeMessage} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold">İptal</button>
          <button onClick={() => {
            pushUndoSnapshot('Sistem kaydı silme');
            rememberDeletedRecordId('logs', log.id);
            setArchivedLogs(prev => prev.filter(item => item.id !== log.id));
            deleteArchivedLogIds([log.id]);
            const nextLogs = (Array.isArray(logsRef.current) ? logsRef.current : [])
              .filter(item => item?.id !== log.id && !isRecordDeleted('logs', item?.id));
            logsRef.current = nextLogs;
            setLogs(nextLogs);
            setSelectedLogIds(prev => prev.filter(id => id !== log.id));
            addLog('ADMIN_KAYIT_SIL', 'Bir sistem kaydı silindi.', null, null, false, null, { deletedLogId: log.id });
            closeMessage();
            setTimeout(() => showMessage('Kayıt Silindi', 'Seçilen sistem kaydı başarıyla silindi.', 'success'), 100);
          }} className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-md flex items-center justify-center gap-2">
            <Trash2 className="w-4 h-4"/> Sil
          </button>
        </div>
      </div>,
      'danger'
    );
  };

  const downloadLogsCsv = (period = 'week') => {
    const safeLogs = visibleLogs;
    const nowDate = new Date();
    const startDate = new Date(nowDate);

    if (period === 'month') {
      startDate.setDate(nowDate.getDate() - 30);
    } else {
      startDate.setDate(nowDate.getDate() - 7);
    }
    startDate.setHours(0, 0, 0, 0);

    const filteredLogs = safeLogs
      .filter(log => Number(log?.time || 0) >= startDate.getTime() && Number(log?.time || 0) <= nowDate.getTime())
      .sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0));

    if (filteredLogs.length === 0) {
      return showMessage(
        'İndirilecek Kayıt Yok',
        period === 'month' ? 'Son 30 güne ait kayıt bulunamadı.' : 'Son 7 güne ait kayıt bulunamadı.',
        'warning'
      );
    }

    const escapeCsv = (value) => {
      const str = String(value ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = [
      ['Tarih', 'Saat', 'İşlem Tipi', 'Masa', 'Açıklama', 'Kullanıcı', 'Cihaz', 'Konum'],
      ...filteredLogs.map(log => {
        const d = new Date(log.time || Date.now());
        return [
          d.toLocaleDateString('tr-TR'),
          d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          String(log.type || 'KAYIT').replace(/_/g, ' '),
          log.deskId || '',
          log.message || '',
          log.userInfo || '',
          log.deviceInfo || '',
          log.locationInfo || ''
        ];
      })
    ];

    // UTF-8 BOM Excel'de Türkçe karakterlerin düzgün görünmesini sağlar.
    const csvContent = '\uFEFF' + rows.map(row => row.map(escapeCsv).join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateKey = getLocalDayKey(nowDate);
    a.href = url;
    a.download = period === 'month'
      ? `sgm_kayitlar_aylik_${dateKey}.csv`
      : `sgm_kayitlar_haftalik_${dateKey}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    addLog(
      'KAYIT_DISA_AKTARILDI',
      `${period === 'month' ? 'Aylık (son 30 gün)' : 'Haftalık (son 7 gün)'} sistem kayıtları CSV/Excel uyumlu formatta indirildi.`
    );
  };

  const handleImportUsers = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedUsers = JSON.parse(event.target.result);
        if (Array.isArray(importedUsers)) {
          const current=usersRef.current || [];
          const migrated=normalizeIdentityUsers(importedUsers);
          const byId=new Map(migrated.map(u=>[u.id,u]));
          current.filter(isRestricted).forEach(u=>byId.set(u.id,u));
          const next=[...byId.values()];usersRef.current=next;setUsers(next);
          addLog('SİSTEM_YEDEK', 'Kullanıcı listesi yedeği sisteme başarıyla yüklendi.');
          showMessage("Başarılı", `${importedUsers.length} öğrenci kaydı sisteme başarıyla yüklendi.`, "success");
        } else {
          showMessage("Hata", "Geçersiz dosya formatı.", "danger");
        }
      } catch (err) {
        showMessage("Hata", "Dosya okunamadı: " + err.message, "danger");
      }
    };
    reader.readAsText(file);
    e.target.value = ''; 
  };

  const handleDownloadDeskQR = async (desk) => {
    if (!desk?.qrCode) return showMessage("QR Bulunamadı", `Masa ${desk?.id || ''} için QR kod bulunamadı.`, "warning");
    try {
      const image = new Image();
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('QR görseli oluşturulamadı.'));
      });
      image.src = getDeskQrImageUrl(desk, 1000);
      await loaded;
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 1000;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Tarayıcı PNG oluşturmayı desteklemiyor.');
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, 1000, 1000);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('PNG dosyası oluşturulamadı.')), 'image/png'
      ));
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `SGM-Masa-${desk.id}-QR.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    } catch (error) {
      console.error('QR indirme hatası:', error);
      showMessage('QR İndirilemedi', error.message || 'QR dosyası oluşturulamadı. Tekrar deneyin.', 'warning');
    }
  };

  const handlePrintQRs = () => {
    const safeDesks = Array.isArray(desksRef.current) ? desksRef.current : [];
    const selectedSet = new Set(selectedQrDeskIds.map(Number));
    const desksToPrint = (selectedSet.size
      ? safeDesks.filter(desk => selectedSet.has(Number(desk.id)))
      : safeDesks).filter(desk => desk.qrCode).sort((a, b) => Number(a.id) - Number(b.id));
    if (!desksToPrint.length) {
      return showMessage("Masa Seçilmedi", "Yazdırmak için QR kodu olan en az bir masa seçin.", "warning");
    }
    const cards = desksToPrint.map(desk => `
      <article class="qr-card">
        <header>Sarıçam Gençlik Merkezi</header>
        <h2>Masa ${escapeHtml(desk.id)}</h2>
        <img src="${getDeskQrImageUrl(desk, 300)}" alt="Masa ${escapeHtml(desk.id)} QR" />
        <p>${escapeHtml(desk.qrCode)}</p>
      </article>
    `).join('');
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showMessage("Açılır Pencere Engellendi", "Tarayıcıda açılır pencerelere izin verip tekrar deneyin.", "warning");
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"/>
        <title>SGM Toplu QR Çıktısı</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 12mm; background: white; font-family: Arial, sans-serif; }
          .qr-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5mm; }
          .qr-card { border: 1px solid #64748b; border-radius: 8px; text-align: center; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
          header { padding: 8px 4px; background: #f1f5f9; font-size: 10px; font-weight: bold; }
          h2 { margin: 10px 0 6px; font-size: 22px; }
          img { display: block; width: 100%; max-width: 35mm; height: auto; margin: 0 auto; }
          p { margin: 6px; font: 9px monospace; overflow-wrap: anywhere; }
          @page { size: A4; margin: 10mm; }
          @media print { body { padding: 0; } }
        </style>
      </head><body><div class="qr-grid">${cards}</div></body></html>
    `);
    printWindow.document.close();
    // Görseller gerçekten yüklenmeden yazdırma penceresi açılmaz.
    Promise.all(Array.from(printWindow.document.images).map(img =>
      img.complete && img.naturalWidth ? Promise.resolve() : new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      })
    )).then(() => {
      if (printWindow.closed) return;
      printWindow.focus();
      printWindow.print();
    }).catch(() => {
      showMessage('QR Yazdırılamadı', 'QR görselleri yüklenemedi. Tekrar deneyin.', 'warning');
    });
  };

  const saveRegistrationFormUrl = async e => {
    e.preventDefault();
    if (registrationLinkSaving) return;
    const url = normalizeRegistrationUrl(new FormData(e.currentTarget).get('formUrl'));
    if (!validRegistrationUrl(url)) return showMessage('Bağlantı Hatalı', 'https://forms.gle/... veya https://docs.google.com/forms/... bağlantısı girin.', 'warning');
    const previous = settingsRef.current;
    if (db && !fbUser) return showMessage('Lütfen Bekleyin', 'Bağlantının tüm cihazlara kaydedilmesi için sistem bağlantısını bekleyin.', 'warning');
    pushUndoSnapshot('Kayıt formu bağlantısını değiştirme');
    setRegistrationLinkSaving(true);
    const makeNext = base => ({ ...base, registrationFormUrl: url,
      registrationFormUpdatedAt: Math.max(Date.now(), Number(base.registrationFormUpdatedAt || 0) + 1),
      registrationFormHistory: base.registrationFormUrl && normalizeRegistrationUrl(base.registrationFormUrl) !== url
        ? [{ url: base.registrationFormUrl, changedAt: Date.now() }, ...(base.registrationFormHistory || [])]
        : (base.registrationFormHistory || []) });
    try {
      let next;
      if (db && fbUser) {
        const ref = getLiveSettingsDoc();
        // Sadece settings belgesini transaction ile güncelle; allData artık kullanılmıyor.
        next = await runTransaction(db, async tx => {
          const snap = await tx.get(ref);
          const base = mergeRegistrationSettings(previous, snap.exists() ? snap.data() : {});
          const updated = makeNext(base);
          tx.set(ref, updated, { merge: true });
          return updated;
        });
        granularBaselineRef.current.settings = stableJson(next);
      } else next = makeNext(previous);
      settingsRef.current = next;
      setSettings(prev => mergeRegistrationSettings(prev, next));
      setRegistrationFormUrl(url);
      try {
        localStorage.setItem('sgm_settings', JSON.stringify(next));
        sessionStorage.setItem('sgm_registration_form_url', url);
      } catch {}
      addLog('ADMIN_KAYIT_FORM_LINK', 'Kayıt formu bağlantısı kaydedildi; önceki bağlantı geçmişte korundu.', null, null, false, null, { previousUrl: previous.registrationFormUrl || '', newUrl: url });
      showMessage('Kaydedildi', db && fbUser ? 'Google Form bağlantısı kaydedildi ve diğer cihazlarda kullanılabilir.' : 'Google Form bağlantısı bu cihazda kaydedildi.', 'success');
    } catch (error) {
      showMessage('Bağlantı Kaydedilemedi', 'Google Form bağlantısı sunucuya kaydedilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.', 'warning');
      addLog('ADMIN_KAYIT_FORM_LINK_HATA', 'Kayıt formu bağlantısı kaydedilemedi.');
    } finally { setRegistrationLinkSaving(false); }
  };

  const resetFeedbackForm = () => {
    setFeedbackForm({ name: '', identityNo: '', type: '', message: '' });
    setFeedbackStep(1);
  };

  const handleFeedbackIdentitySubmit = (e) => {
    e.preventDefault();
    const cleanName = String(feedbackForm.name || '').trim();
    const cleanPhone = cleanIdentityFormat(feedbackForm.identityNo);

    if (!cleanName || cleanPhone.length !== 8) {
      return showMessage('Bilgileri Kontrol Edin', 'Lütfen ad soyad ve geçerli bir GM Özel Kod girin.', 'warning');
    }

    setFeedbackForm(prev => ({ ...prev, name: cleanName, identityNo: cleanPhone }));
    setFeedbackStep(2);
  };

  const selectFeedbackType = (type) => {
    setFeedbackForm(prev => ({ ...prev, type, message: '' }));
    setFeedbackStep(3);
  };

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    if (feedbackInFlightRef.current) return;
    const feedbackUser = requireStudentAction('Dilek / Şikayet gönderme');
    if (!feedbackUser) return;
    if (!checkLibraryOpen()) return showMessage('Kütüphane Kapalı', 'Mesai saatleri dışında geri bildirim gönderilemez.', 'warning');
    const message = String(feedbackForm.message || '').trim();
    if (!feedbackForm.type || message.length < 3) {
      return showMessage('Mesajınızı Yazın', 'Lütfen öneri veya şikayetinizi yazın.', 'warning');
    }

    const newRecord = {
      id: `FDB-${Date.now()}-${generateId()}`,
      time: Date.now(),
      userId: feedbackUser.id,
      name: feedbackUser.name,
      identityNo: feedbackUser.identityNo,
      specialCode: feedbackUser.specialCode,
      type: feedbackForm.type,
      message,
      deviceInfo: navigator.userAgent || '-',
      locationInfo: userLocation || '-'
    };

    feedbackInFlightRef.current = true; setFeedbackSending(true);
    feedbackRecordsRef.current = [newRecord, ...(Array.isArray(feedbackRecordsRef.current) ? feedbackRecordsRef.current : [])];
    setFeedbackRecords(feedbackRecordsRef.current);
    await queueAppend('sgmFeedback', newRecord);
    const confirmed = !readAppendOutbox()[`sgmFeedback/${newRecord.id}`];
    feedbackInFlightRef.current = false; setFeedbackSending(false);
    addLog(
      feedbackForm.type === 'complaint' ? 'UYGULAMA_SIKAYETI' : 'UYGULAMA_ONERISI',
      `${feedbackUser.name} uygulama hakkında ${feedbackForm.type === 'complaint' ? 'şikayet' : 'öneri'} gönderdi.`, null, feedbackUser.id
    );

    resetFeedbackForm();
    showMessage(confirmed ? 'Kaydınız Alındı' : 'Gönderim Bekliyor', confirmed ? 'Geri bildiriminiz başarıyla yöneticiye iletildi. Teşekkür ederiz.' : 'Mesajınız bu cihazda saklandı. Bağlantı veya kota düzeldiğinde otomatik gönderilecek; yöneticiye henüz ulaşmadı.', confirmed ? 'success' : 'warning');
    setView('student_dash');
  };

  const saveCustomLayoutImmediately = async (newLayout) => {
    pushUndoSnapshot('Kroki düzenleme');
    const safeLayout = Array.isArray(newLayout)
      ? newLayout.map(el => ({ ...el }))
      : [];

    const nextSettings = {
      ...settings,
      useCustomLayout: true
    };

    // Önce aynı cihazda anında aktif et.
    layoutSaveGuardRef.current = {
      layout: safeLayout,
      until: Date.now() + 15000
    };

    const deskIdsInLayout = [...new Set(safeLayout.filter(el => el.type === 'desk').map(el => Number(el.deskId)).filter(Number.isFinite))];
    const currentDesks = Array.isArray(desks) ? desks : [];
    const existingIds = new Set(currentDesks.map(d => Number(d.id)));
    const extraDesks = deskIdsInLayout.filter(id => !existingIds.has(id)).map(id => ({
      id, status: 'available', occupant: null, guestOccupant: null, guestSessionStartTime: null,
      guestBreakEndTime: null, guestReported: false, guestReportEndTime: null, guestReportIssuedAt: null,
      guestReportVerifiedAt: null, pendingOccupant: null, pendingDeskRole: null, pendingDeskDeadline: null,
      breakEndTime: null, reportEndTime: null, reportIssuedAt: null, reportVerifiedAt: null,
      sessionStartTime: null, qrCode: 'QR-' + id + '-' + generateId()
    }));
    const nextDesks = extraDesks.length ? [...currentDesks, ...extraDesks].sort((a,b)=>a.id-b.id) : currentDesks;

    setLayoutElements(safeLayout);
    if (extraDesks.length) setDesks(nextDesks);
    setSettings(nextSettings);

    try {
      localStorage.setItem('sgm_layout', JSON.stringify(safeLayout));
      localStorage.setItem('sgm_layout_schema_version', '3');
      localStorage.setItem('sgm_settings', JSON.stringify(nextSettings));
    } catch (e) {
      console.warn('Kroki localStorage kaydı yapılamadı:', e);
    }

    // Firebase aktifse beklemeden yalnızca settings + kroki + değişen masa belgelerini gönder.
    if (isDataLoaded && fbUser && db) {
      try {
        await persistGranularStateNow({
          settings: nextSettings,
          desks: nextDesks,
          layoutElements: safeLayout
        });
        layoutSaveGuardRef.current = null;
      } catch (error) {
        // Genel parçalı senkronizasyon tekrar deneyeceği için korumayı hemen kaldırmıyoruz.
        handleFirestoreQuotaError(error);
      }
    }

    addLog('ADMIN_KROKI_KAYDET', 'Kroki düzeni kaydedildi ve yayınlandı.');
    showMessage(
      "Başarılı",
      "Yeni kroki kaydedildi ve aktif kroki olarak kullanılmaya başlandı.",
      "success"
    );
  };

  const renderLiveKroki = ({
    area = 'all',
    isPublic = false,
    isAdmin = false,
    myDeskId = null,
    onDeskClick = null,
    showBlueRoom = true,
    showMainLibrary = true
  } = {}) => {
    const hasCustomLayout =
      settings.useCustomLayout === true &&
      Array.isArray(layoutElements) &&
      layoutElements.length > 0;

    if (hasCustomLayout) {
      return (
        <DynamicKrokiMap
          desks={Array.isArray(desks) ? desks : []}
          layoutElements={layoutElements}
          myDeskId={myDeskId}
          isPublic={isPublic}
          isAdmin={isAdmin}
          area='main'
          onDeskClick={onDeskClick}
        />
      );
    }

    return <DynamicKrokiMap desks={Array.isArray(desks)?desks:[]} layoutElements={generateDefaultLayout()} myDeskId={myDeskId} isPublic={isPublic} isAdmin={isAdmin} area="main" onDeskClick={onDeskClick}/>;
  };

  const renderView = () => {
    switch (view) {
      
      case 'permission_gate':
        return (
          <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 text-center shadow-2xl border border-slate-700 space-y-6">
              <div className="w-20 h-20 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/30">
                <Shield className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-black text-white">Sarıçam GM Kütüphane</h1>
                <p className="text-slate-400 text-sm">Sistemi güvenli kullanabilmeniz için izinlerin onaylanması gerekmektedir.</p>
              </div>
              {batteryGuidanceOpen && <div className="text-left p-4 bg-slate-900 rounded-xl text-sm text-slate-300 space-y-3"><p className="font-bold text-white">Pil optimizasyonu: Kısıtlanmamış</p><p>Android: Ayarlar → Uygulamalar → kullandığınız tarayıcı / uygulama → Pil → Kısıtlanmamış. Telefonunuzda seçenek adı değişebilir. Bu ayarı telefonunuzdan seçmeniz gerekir.</p><button onClick={() => { addLog('PIL_AYARI_KULLANICI_BEYANI', 'Kullanıcı pil ayarını kontrol ettiğini belirtti; cihaz ayarı tarayıcıdan doğrulanamaz.'); setBatteryGuidanceOpen(false); }} className="px-3 py-2 bg-blue-600 text-white rounded-lg">Pil ayarını kontrol ettim</button></div>}
              <button onClick={requestScreenWakeLock} className="w-full p-3 border border-slate-600 text-white rounded-xl">{wakeLockStatus === 'active' ? 'Ekranı açık tutma etkin' : 'Ekranı Açık Tut'}</button>
              {['unsupported', 'denied'].includes(wakeLockStatus) && <p className="text-xs text-slate-400">Bu cihaz ekranı açık tutma isteğini desteklemiyor veya kabul etmedi.</p>}
              <button 
                onClick={permissionsState === 'granted' ? () => setView('role_select') : requestAllPermissions} 
                className={`w-full text-white font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 ${permissionsState === 'granted' ? 'bg-green-600 hover:bg-green-500' : 'bg-blue-600 hover:bg-blue-500'}`}
              >
                {permissionsState === 'idle' && <><CheckCircle className="w-5 h-5"/> İzinleri Ver ve Başla</>}
                {permissionsState === 'requesting' && <><RefreshCw className="w-5 h-5 animate-spin"/> İzinler İsteniyor...</>}
                {permissionsState === 'granted' && <><LogIn className="w-5 h-5"/> Sisteme Giriş Yap</>}
              </button>
            </div>
          </div>
        );

      case 'role_select':
        return (
          <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full space-y-6">
              <div className="text-center space-y-2 mb-8">
                <div 
                   className="w-20 h-20 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-200 mb-4 cursor-pointer"
                   onClick={() => setView('admin_login')}
                   title="Geliştirici"
                >
                  <BookOpen className="w-10 h-10" />
                </div>
                <h1 className="text-3xl font-black text-slate-800">Sarıçam GM</h1>
                <p className="text-slate-500 font-medium">Kütüphane Yönetim Sistemi</p>
              </div>

              <div className="space-y-4">
                {!checkLibraryOpen() && (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
                    <div className="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-black text-red-700">Kütüphane Kapalı</h3>
                      <p className="text-sm text-red-600 mt-1">
                        Öğrenci sistemi {settings.openTime || '07:00'}'de açılacaktır. Çalışma saatleri: {settings.openTime || '07:00'} - {settings.closeTime || '22:00'}.
                      </p>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    if (!checkLibraryOpen()) {
                      return showMessage(
                        "Kütüphane Kapalı",
                        `Öğrenci sistemi ${settings.openTime || '07:00'}'de açılacaktır. Çalışma saatleri: ${settings.openTime || '07:00'} - ${settings.closeTime || '22:00'}.`,
                        "warning"
                      );
                    }
                    setView('student_login');
                  }}
                  className={`w-full p-6 rounded-2xl shadow-sm border flex items-center justify-between group transition-all ${
                    checkLibraryOpen()
                      ? 'bg-white hover:shadow-md border-slate-100'
                      : 'bg-slate-100 border-slate-200 cursor-not-allowed opacity-75'
                  }`}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors"><Smartphone className="w-6 h-6"/></div>
                    <div className="text-left">
                      <h3 className="font-bold text-slate-800 text-lg">Öğrenci Girişi</h3>
                      <p className="text-slate-500 text-sm">Masa almak ve mola için</p>
                    </div>
                  </div>
                  <ArrowRight className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                </button>

                <button onClick={() => setView('public')} className="w-full bg-white p-6 rounded-2xl shadow-sm hover:shadow-md border border-slate-100 flex items-center justify-between group transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-50 text-green-600 rounded-xl flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors"><Eye className="w-6 h-6"/></div>
                    <div className="text-left">
                      <h3 className="font-bold text-slate-800 text-lg">Halka Açık Ekran</h3>
                      <p className="text-slate-500 text-sm">Anlık masa doluluk durumu</p>
                    </div>
                  </div>
                  <ArrowRight className="text-slate-300 group-hover:text-green-500 transition-colors" />
                </button>


              </div>
            </div>
          </div>
        );

      case 'feedback':
        if (!myUserObj || isRestricted(myUserObj) || myUserObj.blocked) return <div className="p-8 text-center"><p>Kısıtlı hesaplar dilek / şikayet gönderemez.</p><button onClick={() => setView('student_dash')} className="mt-4 p-3 bg-blue-600 text-white rounded-xl">Masa ekranına dön</button></div>;
        return (
          <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
            <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
              <div className="bg-purple-600 p-8 text-center relative overflow-hidden">
                <button onClick={() => { resetFeedbackForm(); setView('student_dash'); }} className="absolute top-4 left-4 text-white/80 hover:text-white"><ArrowRight className="w-6 h-6 rotate-180" /></button>
                <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                  <FileText className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white">Dilek / Şikayet</h2>
                <p className="text-purple-100 text-sm mt-2">Uygulama hakkındaki görüşlerinizi bize iletebilirsiniz.</p>
              </div>

              {feedbackStep === 1 && (
                <form onSubmit={handleFeedbackIdentitySubmit} className="p-8 space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Ad Soyad</label>
                    <input type="text" value={feedbackForm.name} onChange={e => setFeedbackForm(prev => ({ ...prev, name: e.target.value }))} required placeholder="Adınız Soyadınız" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">GM Özel Kodunuz</label>
                    <input type="text" inputMode="numeric" minLength={8} maxLength={8} value={feedbackForm.identityNo} onChange={e => setFeedbackForm(prev => ({ ...prev, identityNo: e.target.value }))} required placeholder="12345678" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" />
                  </div>
                  <button type="submit" className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold flex items-center justify-center gap-2">Devam Et <ArrowRight className="w-5 h-5"/></button>
                </form>
              )}

              {feedbackStep === 2 && (
                <div className="p-8 space-y-5">
                  <div className="text-center">
                    <h3 className="text-xl font-black text-slate-800">Ne bildirmek istiyorsunuz?</h3>
                    <p className="text-sm text-slate-500 mt-1">Şikayet veya öneri türünü seçin.</p>
                  </div>
                  <button onClick={() => selectFeedbackType('complaint')} className="w-full p-5 border-2 border-red-100 hover:border-red-400 bg-red-50 hover:bg-red-100 rounded-2xl text-left transition-all">
                    <div className="font-black text-red-700 text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5"/> Şikayet</div>
                    <p className="text-sm text-red-600 mt-1">Uygulamada yaşadığınız bir sorun veya memnuniyetsizliği bildirin.</p>
                  </button>
                  <button onClick={() => selectFeedbackType('suggestion')} className="w-full p-5 border-2 border-green-100 hover:border-green-400 bg-green-50 hover:bg-green-100 rounded-2xl text-left transition-all">
                    <div className="font-black text-green-700 text-lg flex items-center gap-2"><CheckCircle className="w-5 h-5"/> Öneri</div>
                    <p className="text-sm text-green-600 mt-1">Uygulamayı geliştirmek için fikrinizi veya önerinizi paylaşın.</p>
                  </button>
                  <button onClick={() => setFeedbackStep(1)} className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold">Geri</button>
                </div>
              )}

              {feedbackStep === 3 && (
                <form onSubmit={handleFeedbackSubmit} className="p-8 space-y-5">
                  <div className={`p-4 rounded-xl border ${feedbackForm.type === 'complaint' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
                    <div className="font-black">{feedbackForm.type === 'complaint' ? 'Şikayet Bildirimi' : 'Öneri Bildirimi'}</div>
                    <div className="text-xs mt-1">{feedbackForm.name} • {feedbackForm.identityNo}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">{feedbackForm.type === 'complaint' ? 'Şikayetiniz' : 'Öneriniz'}</label>
                    <textarea value={feedbackForm.message} onChange={e => setFeedbackForm(prev => ({ ...prev, message: e.target.value }))} required rows={6} placeholder={feedbackForm.type === 'complaint' ? 'Yaşadığınız sorunu detaylı şekilde yazabilirsiniz...' : 'Önerinizi detaylı şekilde yazabilirsiniz...'} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none resize-none" />
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setFeedbackStep(2)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold">Geri</button>
                    <button type="submit" disabled={feedbackSending} className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl font-bold">{feedbackSending ? 'Gönderiliyor…' : 'Gönder'}</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        );

      case 'student_login':
        if (!checkLibraryOpen()) {
          return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
              <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-red-100 p-8 text-center">
                <div className="w-20 h-20 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
                  <Clock className="w-10 h-10" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Kütüphane Kapalı</h2>
                <p className="text-slate-600 mt-3">
                  Öğrenci sistemi <b>{settings.openTime || '07:00'}</b>'de yeniden açılacaktır.
                </p>
                <p className="text-sm text-slate-500 mt-2">
                  Çalışma saatleri: {settings.openTime || '07:00'} - {settings.closeTime || '22:00'}
                </p>
                <button
                  onClick={() => setView('role_select')}
                  className="w-full mt-6 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold transition-colors"
                >
                  Geri Dön
                </button>
              </div>
            </div>
          );
        }

        return (
          <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
            <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
              <div className="bg-blue-600 p-8 text-center relative overflow-hidden">
                <button onClick={() => setView('role_select')} className="absolute top-4 left-4 text-white/80 hover:text-white"><ArrowRight className="w-6 h-6 rotate-180" /></button>
                <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                  <User className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white">Öğrenci Girişi</h2>
              </div>
              <form onSubmit={handleStudentLogin} className="p-8 space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">GM Özel Kodunuz</label>
                  <input 
                      type="text" inputMode="numeric" minLength={8} maxLength={8}
                      name="identityNo"
                      value={loginIdentity}
                      onChange={e => setLoginIdentity(e.target.value.replace(/\D/g,'').slice(0,8))}
                      required 
                      placeholder="12345678"
                      autoComplete="username"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Şifreniz</label>
                  <input 
                      type="text"
                      name="pin"
                      value={loginPin}
                      onChange={e => setLoginPin(e.target.value.replace(/\D/g,'').slice(0,8))}
                      required
                      minLength={8}
                      maxLength={8}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="********"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      style={{ WebkitTextSecurity: 'disc' }}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium tracking-widest"
                  />
                </div>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-200">Giriş Yap <LogIn className="w-5 h-5" /></button>
                <button type="button" onClick={()=>{setRegistrationAccepted(false);setRegistrationRulesOpen(true);setShowRules(true);}} className="w-full py-3 border border-blue-300 text-blue-700 rounded-xl font-bold">Kayıt Ol</button>
                {registrationPending && registrationFormOpened && <p className="text-sm text-blue-700">Kayıt formuna <b>GM özel kodunu yazmayı unutmayın.</b> Formu gönderin; yönetici kontrol ettikten sonra kısıtı kaldıracaktır.</p>}
                <button type="button" disabled={registrationBusy} onClick={prepareNewStudentRegistration} className="text-sm font-bold text-blue-700 disabled:opacity-50">Başka öğrenci için yeni kayıt</button>
                {registrationError && <p role="alert" className="text-sm text-red-700">{registrationError}</p>}
                {registrationResult && <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                  <div className="font-black text-amber-900 text-lg">Önemli: Bu bilgileri unutmayın ve kaybetmeyin!</div>
                  <p className="text-sm text-amber-800">Hesabınız oluşturuldu ancak güvenlik nedeniyle şu anda <b>kısıtlıdır</b>. GM Özel Kodunuz ve şifreniz ile doğrudan giriş yapabilirsiniz. Form ve sorumlu kontrolü tamamlanana kadar masa, ihbar ve dilek / şikayet işlemleri kapalıdır.</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border"><span><b>GM Özel Kod:</b> <span className="font-mono font-black text-indigo-700 tracking-widest">{registrationResult.specialCode}</span></span><button type="button" onClick={()=>copyRegistrationValue('GM Özel Kod',registrationResult.specialCode)} className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-bold">Kopyala</button></div>
                    <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border"><span><b>Şifre:</b> <span className="font-mono tracking-widest">{registrationResult.pin}</span></span><button type="button" onClick={()=>copyRegistrationValue('Şifre',registrationResult.pin)} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg font-bold">Kopyala</button></div>
                  </div>
                  <p className="text-sm font-bold text-amber-900">Kayıt formuna GM özel kodunu yazmayı unutmayın.</p>
                  <button type="button" onClick={fillRegistrationLogin} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold">Bu Bilgilerle Giriş Yap</button>
                  <button type="button" disabled={registrationRedirectBusy} onClick={openRegistrationGoogleForm} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold">{registrationRedirectBusy ? 'Google Form Açılıyor…' : 'Google Form’a Devam Et'}</button>
                  {registrationFormOpened && <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800"><b>Son adım:</b> Google Formu tamamlayıp gönderin. Formdaki “GM Özel Kod” alanına <b>{registrationResult.specialCode}</b> kodunu girin. Form tamamlandıktan sonra kurumumuzun kütüphane sorumlusu ile iletişime geçin. Gerekli kontroller yapıldıktan sonra hesabınızın kısıtı kaldırılır ve sistemi kullanmaya devam edebilirsiniz.</div>}
                  <button type="button" onClick={()=>{sessionStorage.removeItem('sgm_registration_form_opened');sessionStorage.removeItem('sgm_registration_token');sessionStorage.removeItem('sgm_registration_credentials');sessionStorage.removeItem('sgm_registration_form_url');setRegistrationPending('');setRegistrationResult(null);setRegistrationFormUrl('');setRegistrationFormOpened(false);}} className="block font-bold text-slate-600">Bilgilerimi kaydettim, kapat</button>
                </div>}

              </form>
            </div>
          </div>
        );

      case 'student_dash':
        return (
          <div className="min-h-screen bg-slate-100 flex flex-col">
            <nav className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-3 flex justify-between items-center shadow-sm">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 p-2 rounded-lg text-white"><BookOpen className="w-5 h-5" /></div>
                <div className="hidden sm:block">
                  <h1 className="font-bold text-slate-800 leading-tight">SGM Kütüphane</h1>
                  <p className="text-xs text-slate-500">Hoş geldin, {myUserObj?.name || 'Öğrenci'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                <button
                  type="button"
                  onClick={retryMyPhonePushRegistration}
                  title="Telefon bildirimini yeniden etkinleştir"
                  aria-label="Telefon bildirimini yeniden etkinleştir"
                  className={`p-2.5 rounded-xl border transition-colors flex items-center justify-center ${
                    Array.isArray(myUserObj?.pushTokens) && myUserObj.pushTokens.some(Boolean)
                      ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                      : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  <Smartphone className="w-5 h-5" />
                </button>

                {usersSyncError && <p role="alert" className="text-sm text-amber-800">{usersSyncError}</p>}
                {myUserObj?.strikes > 0 && (
                   <div className="flex items-center gap-1 text-red-600 text-xs font-bold bg-red-50 border border-red-100 px-3 py-1.5 rounded-full animate-pulse">
                      <AlertTriangle className="w-4 h-4" /> {Number.isFinite(Number(myUserObj.strikes)) ? Number(myUserObj.strikes) : 0}/{Number.isFinite(Number(settings.strikeLimit)) && Number(settings.strikeLimit) > 0 ? Number(settings.strikeLimit) : DEFAULT_SETTINGS.strikeLimit} İhlal
                   </div>
                )}
                <button disabled={studentRestricted} onClick={openStudentFeedback} className="text-purple-700 bg-purple-50 px-3 py-2 rounded-xl font-bold text-sm">Dilek / Şikayet</button>
                <button onClick={() => setShowRules(true)} className="text-blue-600 hover:text-blue-800 bg-blue-50 p-2 rounded-full flex items-center gap-1 text-sm font-bold px-3"><Info className="w-5 h-5" /> <span className="hidden sm:inline">Kurallar</span></button>
                <button onClick={logoutStudent} className="text-slate-500 hover:text-slate-800 bg-slate-100 p-2 rounded-full"><LogOut className="w-5 h-5" /></button>
              </div>
            </nav>

            <main className="flex-1 max-w-5xl mx-auto w-full p-4 lg:p-6 space-y-6">
              {studentRestricted && <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl"><b>Hesabınız kısıtlı.</b> Masa seçimi, boş masa ihbarı ve dilek / şikayet kapalıdır. {myUserObj?.restrictionReason} Kütüphane sorumlusu gerekli kontrollerden sonra kısıtı kaldırabilir.<button onClick={refreshStudentProfile} className="block mt-2 px-3 py-2 bg-white border border-amber-300 rounded-lg font-bold">Hesap Durumunu Yenile</button></div>}
              {!studentRestricted && studentDeskWait > 0 && <div className="p-4 bg-blue-50 border border-blue-200 text-blue-900 rounded-2xl"><b>Yeniden masa almak için kalan süre: {formatTime(studentDeskWait)}</b><p>Sistem hatası durumunda yönetici size masa atayabilir.</p></div>}
              {registrationResult && myUserObj?.pendingApproval && <div className="p-4 bg-white border rounded-2xl space-y-2"><p><b>GM özel kodunu yazmayı unutmayın:</b> {myUserObj.specialCode}</p><button disabled={registrationRedirectBusy} onClick={openRegistrationGoogleForm} className="p-3 bg-green-600 text-white rounded-xl">Kayıt formunu aç</button></div>}
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden relative">
                <div className={`h-2 w-full ${!myDesk ? 'bg-slate-300' : myIsOnBreak ? 'bg-yellow-400' : myIsReported ? 'bg-red-500' : 'bg-green-500'}`} />
                
                <div className="p-6 md:p-8">
                  {!myDesk ? (
                    <div className="text-center py-10">
                      <div className="w-24 h-24 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-6"><MapPin className="w-12 h-12" /></div>
                      <h2 className="text-2xl font-bold text-slate-800 mb-2">Masasızsınız</h2>
                      <p className="text-slate-500 mb-6 max-w-lg mx-auto">Önce kullanmak istediğiniz masayı seçin. Seçimden sonra o masanın QR kodunu okutmak için <b>5 dakikanız</b> olacak.</p>

                      {!selectedDeskId ? (
                        <div className="max-w-xl mx-auto space-y-4">
                          <div className="text-left">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Masanızı Seçin</label>
                            <select
                              id="student_desk_select"
                              disabled={studentRestricted || studentDeskWait > 0}
                              defaultValue=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                selectDeskForClaim(e.target.value);
                              }}
                              className="w-full p-4 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                              <option value="">Masa seçiniz...</option>
                              {safeDesksList
                                .filter(d => !(d.pendingOccupant && Number(d.pendingDeskDeadline || 0) > now))
                                .filter(d => d.status === 'available' && !lostDeskToday(myUserObj, d.id))
                                .sort((a,b) => a.id - b.id)
                                .map(d => (
                                  <option key={d.id} value={d.id}>
                                    Masa {d.id} • Boş
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div className="w-full bg-blue-50 border border-blue-200 text-blue-800 px-5 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                            <Clock className="w-5 h-5"/> Masa seçildiği anda 5 dakikalık QR süresi otomatik başlar.
                          </div>
                        </div>
                      ) : (
                        <div className="max-w-xl mx-auto bg-blue-50 border-2 border-blue-200 rounded-2xl p-5 space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="text-left">
                              <p className="text-xs font-bold text-blue-600 uppercase tracking-wide">Seçilen Masa</p>
                              <p className="text-3xl font-black text-slate-800">Masa {selectedDeskId}</p>
                            </div>
                            <div className="bg-white border border-blue-200 rounded-xl px-4 py-3">
                              <p className="text-xs font-bold text-slate-500">QR İçin Kalan Süre</p>
                              <p className="font-mono text-2xl font-black text-blue-700">{formatTime(Math.max(0, deskSelectionDeadline - now))}</p>
                            </div>
                          </div>
                          <p className="text-sm text-slate-600 text-left">Yalnızca <b>Masa {selectedDeskId}</b> üzerindeki QR kod kabul edilir. Farklı masa QR kodu okutulursa işlem yapılmaz.</p>
                          <div className="flex flex-col sm:flex-row gap-3">
                            <button disabled={studentRestricted || studentDeskWait > 0} onClick={() => setScannerConfig({ isOpen: true, mode: 'claim', title: `Masa ${selectedDeskId} QR Doğrulaması` })} className="flex-1 bg-blue-600 text-white px-5 py-4 rounded-xl hover:bg-blue-700 shadow-md flex items-center justify-center gap-2 font-bold">
                              <QrCode className="w-5 h-5"/> Seçilen Masanın QR'ını Okut
                            </button>
                            <button onClick={() => cancelDeskSelection()} className="px-5 py-4 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold">Seçimi İptal Et</button>
                          </div>
                        </div>
                      )}

                      <div className="mt-5 max-w-xl mx-auto">
                        <button disabled={studentRestricted} onClick={() => { if (requireStudentAction('Boş masa ihbarı')) setScannerConfig({ isOpen: true, mode: 'report', title: 'İhbar İçin QR Okut' }); }} className="w-full bg-orange-500 text-white px-6 py-4 rounded-xl hover:bg-orange-600 shadow-md flex items-center justify-center gap-2 font-bold text-lg">
                            <ShieldAlert className="w-6 h-6"/> Boş Masayı İhbar Et
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row gap-8 items-center md:items-stretch">
                      <div className="flex-1 text-center md:text-left flex flex-col justify-center w-full">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold mb-4 bg-slate-100 text-slate-600 w-fit md:mx-0 mx-auto">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Aktif Oturum
                        </div>
                        <h2 className="text-5xl font-black text-slate-800 tracking-tighter mb-2">Masa {myDesk.id}</h2>
                        
                        {myIsReported && (
                          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-left animate-pulse">
                            <div className="flex gap-3 text-red-700 mb-3"><ShieldAlert className="w-6 h-6 shrink-0" /><div><p className="font-bold">Masanız boş olarak bildirildi!</p><p className="text-sm mt-1">İhbar Kalan Süre: {formatTime(myReportEndTime - now)}</p></div></div>
                            <button onClick={() => setScannerConfig({ isOpen: true, mode: 'verify', title: 'Masadayım Doğrulaması' })} className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-md flex justify-center items-center gap-2"><QrCode className="w-5 h-5"/> Masadayım, Doğrula!</button>
                          </div>
                        )}

                        {myIsOnBreak && (
                          <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-xl p-5 flex flex-col items-center">
                            <Coffee className="w-10 h-10 text-yellow-600 mb-2" />
                            <p className="text-yellow-800 font-bold mb-1 text-center">Mola Devam Ediyor</p>
                            <div className="text-4xl font-mono font-black text-yellow-700 my-3 tracking-widest">{formatTime(myBreakEndTime - now)}</div>
                            <button onClick={() => setScannerConfig({ isOpen: true, mode: 'return_break', title: 'Moladan Dönüş - Masa QR Doğrulaması' })} className="px-6 py-2 bg-yellow-200 hover:bg-yellow-300 text-yellow-800 font-bold rounded-full transition-colors flex items-center gap-2"><QrCode className="w-4 h-4" /> QR Okut ve Masaya Dön</button>
                          </div>
                        )}
                      </div>

                      {!myIsReported && !myIsOnBreak && (
                        <div className="w-full md:w-80 flex-shrink-0 space-y-3 flex flex-col justify-center border-t md:border-t-0 md:border-l border-slate-100 pt-6 md:pt-0 md:pl-8">
                          <button onClick={() => startBreak('short')} disabled={myUserObj?.breaks?.short <= 0} className="w-full flex items-center justify-between p-4 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed border border-amber-200 rounded-2xl group transition-all">
                            <div className="flex items-center gap-3 text-amber-800">
                              <div className="bg-amber-200 p-2 rounded-lg"><Coffee className="w-5 h-5" /></div>
                              <div className="text-left"><p className="font-bold">Kısa Mola</p><p className="text-xs opacity-80">{settings.shortBreakDuration} Dk</p></div>
                            </div>
                            <span className="font-black text-amber-700 bg-amber-200/50 px-3 py-1 rounded-lg">{myUserObj?.breaks?.short || 0} Kaldı</span>
                          </button>
                          
                          <button onClick={() => startBreak('long')} disabled={myUserObj?.breaks?.long <= 0} className="w-full flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-200 rounded-2xl group transition-all">
                            <div className="flex items-center gap-3 text-blue-800">
                              <div className="bg-blue-200 p-2 rounded-lg"><Clock className="w-5 h-5" /></div>
                              <div className="text-left"><p className="font-bold">Uzun Mola</p><p className="text-xs opacity-80">{settings.longBreakDuration} Dk</p></div>
                            </div>
                            <span className="font-black text-blue-700 bg-blue-200/50 px-3 py-1 rounded-lg">{myUserObj?.breaks?.long || 0} Kaldı</span>
                          </button>

                          <div className="h-4"></div>
                          <button onClick={releaseDesk} className="w-full flex items-center justify-center gap-2 p-4 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-2xl shadow-lg transition-all"><StopCircle className="w-5 h-5" /> Masayı Bırak / Çıkış Yap</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-3 sm:p-6 overflow-hidden">
                  <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-5 gap-4">
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg">Masa Durumları (Kroki)</h3>
                      <p className="text-sm text-slate-500 mt-1">
                        Şikayet / ihbar için önce alanı seçin, ardından krokide dolu olan masaya dokunun.
                      </p>
                    </div>

                    <div className="w-full lg:w-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {settings.showMainLibraryKroki !== false && (
                        <button
                          type="button"
                          onClick={() => setStudentKrokiArea('main')}
                          className={`w-full lg:min-w-[170px] px-4 py-3 rounded-xl font-black flex items-center justify-center gap-2 transition-all ${
                            studentKrokiArea === 'main'
                              ? 'bg-blue-600 text-white shadow-md'
                              : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          <BookOpen className="w-5 h-5 shrink-0" />
                          <span>Ana Salon</span>
                        </button>
                      )}


                    </div>
                  </div>

                  {settings.showMainLibraryKroki === false && settings.showBlueRoomKroki === false ? (
                    <div className="w-full py-12 px-4 text-center bg-slate-50 border border-slate-200 rounded-2xl">
                      <MapPin className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                      <p className="font-bold text-slate-700">Şu anda görüntülenebilir kroki bulunmuyor.</p>
                      <p className="text-sm text-slate-500 mt-1">Kroki yönetici tarafından tekrar yayına açıldığında burada otomatik görünecektir.</p>
                    </div>
                  ) : (
                    <div className="w-full overflow-hidden">
                      {renderLiveKroki({
                        myDeskId: myDesk?.id,
                        area:
                          studentKrokiArea === 'main' && settings.showMainLibraryKroki !== false
                            ? 'main'
                            : studentKrokiArea === 'blue' && settings.showBlueRoomKroki !== false
                              ? 'blue'
                              : settings.showMainLibraryKroki !== false
                                ? 'main'
                                : 'blue',
                        showBlueRoom: settings.showBlueRoomKroki !== false,
                        showMainLibrary: settings.showMainLibraryKroki !== false,
                        onDeskClick: (desk) => {
                          if (desk.status === 'occupied') {
                            promptReportDesk(desk.id);
                          }
                        }
                      })}
                    </div>
                  )}
              </div>
            </main>
          </div>
        );

      case 'public':
        return (
          <div className="min-h-screen bg-slate-50 p-4 md:p-8 flex flex-col items-center">
            <div className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-center mb-6 border-b border-slate-300 pb-4 gap-4 text-center sm:text-left">
              <div className="flex items-center gap-4">
                <button onClick={() => setView('role_select')} className="text-slate-500 hover:text-slate-800 bg-white p-2 rounded-lg shadow-sm"><ArrowRight className="w-6 h-6 rotate-180" /></button>
                <div>
                  <h1 className="text-2xl font-black text-slate-800">SGM Kütüphanesi</h1>
                  <p className="text-slate-500 text-sm">Canlı Masa Durumu Ekranı</p>
                </div>
              </div>
            </div>

            <div className="w-full max-w-5xl mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-3 rounded-2xl shadow-sm border border-slate-200">
                {settings.showMainLibraryKroki !== false && (
                  <button
                    type="button"
                    onClick={() => setPublicKrokiArea('main')}
                    className={`px-5 py-4 rounded-xl font-black flex items-center justify-center gap-2 transition-all ${
                      publicKrokiArea === 'main'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <BookOpen className="w-5 h-5" /> Ana Salon
                  </button>
                )}

              </div>
            </div>

            <div className="w-full max-w-5xl bg-white rounded-3xl shadow-sm border border-slate-200 p-3 sm:p-6 overflow-hidden">
              {settings.showMainLibraryKroki === false && settings.showBlueRoomKroki === false ? (
                <div className="py-16 text-center">
                  <Eye className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <h2 className="text-xl font-black text-slate-700">Kroki şu anda yayında değil</h2>
                  <p className="text-sm text-slate-500 mt-2">Yönetici panelinden bir alan yeniden açıldığında bu ekran anlık olarak güncellenir.</p>
                </div>
              ) : publicKrokiArea === 'blue' && settings.showBlueRoomKroki !== false ? (
                renderLiveKroki({
                  isPublic: true,
                  area: 'blue',
                  showBlueRoom: settings.showBlueRoomKroki !== false,
                  showMainLibrary: settings.showMainLibraryKroki !== false
                })
              ) : settings.showMainLibraryKroki !== false ? (
                renderLiveKroki({
                  isPublic: true,
                  area: 'main',
                  showBlueRoom: settings.showBlueRoomKroki !== false,
                  showMainLibrary: settings.showMainLibraryKroki !== false
                })
              ) : (
                renderLiveKroki({
                  isPublic: true,
                  area: 'blue',
                  showBlueRoom: settings.showBlueRoomKroki !== false,
                  showMainLibrary: settings.showMainLibraryKroki !== false
                })
              )}
            </div>
          </div>
        );

      case 'admin_login':
        return (
          <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
            <div className="max-w-md w-full bg-slate-800 rounded-3xl shadow-2xl overflow-hidden border border-slate-700">
              <div className="p-8 text-center relative border-b border-slate-700">
                <button onClick={() => setView('role_select')} className="absolute top-4 left-4 text-slate-400 hover:text-white"><ArrowRight className="w-6 h-6 rotate-180" /></button>
                <div className="w-16 h-16 bg-slate-700 text-slate-300 rounded-2xl flex items-center justify-center mx-auto mb-4"><Shield className="w-8 h-8" /></div>
                <h2 className="text-2xl font-bold text-white">Yönetici Paneli</h2>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const user = e.target.username.value;
                const pass = e.target.password.value;
                try {
                  const response = await fetch('/api/admin-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: user, password: pass })
                  });
                  const payload = await response.json().catch(() => null);
                  if (!response.ok || payload?.ok !== true || !payload?.token) {
                    const title = response.status === 401 ? 'Hatalı Giriş' : 'Yönetici Servisi Hatası';
                    showMessage(title, payload?.message || `Yönetici servisi HTTP ${response.status} döndürdü. Vercel dağıtımını ve ortam değişkenlerini kontrol edin.`, 'danger');
                    return;
                  }
                  if (!auth) throw new Error('Firebase ayarları bulunamadı.');
                  const credential = await signInTabWithCustomToken(payload.token);
                  const claims = await credential.user.getIdTokenResult(true);
                  if (auth.currentUser?.uid !== credential.user.uid || claims.claims.admin !== true) throw new Error('Yönetici yetkisi doğrulanamadı.');
                  verifiedAdminUidRef.current = credential.user.uid;
                  setFbUser(credential.user);
                  setAdminAuthorized(true);
                  addLog('ADMIN_GIRIS', 'Yönetici paneline giriş yapıldı.');
                  setView('admin_dash');
                } catch (error) {
                  console.error('Yönetici doğrulama hatası:', error);
                  showMessage('Bağlantı Hatası', error.message || 'Yönetici doğrulama servisine ulaşılamadı.', 'danger');
                }
              }} className="p-8 space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Kullanıcı Adı</label>
                  <input type="text" name="username" required className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Şifre</label>
                  <input type="password" name="password" required className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl focus:border-blue-500 outline-none" />
                </div>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors">Giriş Yap</button>
              </form>
            </div>
          </div>
        );

      case 'admin_dash':
        return (
          <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row">
            <aside className={`bg-slate-900 text-white sticky top-0 z-40 shrink-0 border-r border-slate-800 transition-all duration-300 w-full h-auto lg:h-screen ${adminMenuOpen ? 'lg:w-72' : 'lg:w-48'}`}>
              <button
                type="button"
                onClick={() => setAdminMenuOpen(prev => !prev)}
                className="w-full px-4 sm:px-5 py-4 lg:py-5 flex items-center gap-3 hover:bg-slate-800 transition-colors border-b border-slate-800 text-left"
                title={adminMenuOpen ? 'Yönetici menüsünü kapat' : 'Yönetici menüsünü aç'}
              >
                <Shield className="w-7 h-7 text-blue-400 shrink-0" />
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="font-black text-xl leading-tight">SGM<span className="lg:hidden"> </span><br className="hidden lg:block"/>Admin</span>
                  <ArrowRight className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${adminMenuOpen ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {adminMenuOpen && (
                <div className="max-h-[72vh] lg:h-[calc(100vh-89px)] lg:max-h-none flex flex-col overflow-hidden shadow-2xl lg:shadow-none">
                  <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 lg:py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-2 lg:gap-1 content-start">
                    {[
                      { id: 'desks', icon: <MapPin className="w-5 h-5"/>, label: 'Kroki' },
                      { id: 'layout_editor', icon: <Edit3 className="w-5 h-5"/>, label: 'Kroki Editörü' },
                      { id: 'users', icon: <Users className="w-5 h-5"/>, label: 'Kullanıcılar' },
                      { id: 'settings', icon: <Settings className="w-5 h-5"/>, label: 'Ayarlar' },
                      { id: 'registration', icon: <Users className="w-5 h-5"/>, label: 'Kayıt / Google Form' },
                      { id: 'logs', icon: <List className="w-5 h-5"/>, label: 'Kayıtlar' },
                      { id: 'violations', icon: <ShieldAlert className="w-5 h-5"/>, label: 'İhlal Kayıtları' },
                      { id: 'feedback', icon: <FileText className="w-5 h-5"/>, label: 'Dilek / Şikayet' },
                      { id: 'qr_print', icon: <QrCode className="w-5 h-5"/>, label: 'Toplu QR' },
                      { id: 'push_status', icon: <Smartphone className="w-5 h-5"/>, label: 'Push Durumu' },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => { setAdminTab(tab.id); addLog('ADMIN_SEKME', `${tab.label} sekmesi açıldı.`); }}
                        className={`w-full min-h-12 px-3 sm:px-4 py-3 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 sm:gap-3 transition-colors ${adminTab === tab.id ? 'bg-blue-600 text-white shadow-md' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                      >
                        <span className="shrink-0">{tab.icon}</span>
                        <span className="truncate text-left">{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="p-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={async () => { addLog('ADMIN_CIKIS', 'Yönetici panelinden çıkış yapıldı.'); await appendChainRef.current; setAdminAuthorized(false); setView('role_select'); if (auth) { await signOut(auth); await signInTabAnonymously(); } }}
                      className="w-full px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-3 text-slate-300 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                    >
                      <LogOut className="w-5 h-5" />
                      <span>Çıkış Yap</span>
                    </button>
                  </div>
                </div>
              )}
            </aside>

            <div className="flex-1 min-w-0 w-full flex flex-col">
            <main className="flex-1 max-w-7xl mx-auto w-full p-3 sm:p-4 lg:p-6">
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Her Sekme İçin Geri Al</p>
                  <p className="text-sm font-semibold text-slate-700 mt-0.5">
                    {getCurrentTabUndoSnapshot() ? `Geri alınabilir son işlem: ${getCurrentTabUndoSnapshot().label}` : 'Bu sekmede geri alınabilir işlem bulunmuyor.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={undoLastAdminOperation}
                  disabled={!getCurrentTabUndoSnapshot()}
                  className="px-5 py-3 bg-amber-100 hover:bg-amber-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-amber-800 rounded-xl font-bold flex items-center justify-center gap-2 shrink-0"
                  title={getCurrentTabUndoSnapshot() ? `${getCurrentTabUndoSnapshot().label} işlemini geri al` : 'Bu sekmede geri alınacak işlem yok'}
                >
                  <RefreshCw className="w-5 h-5"/> Geri Al
                </button>
              </div>
              
              {adminTab === 'desks' && (
                <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200">
                  {(!app && !db) && (
                      <div className="mb-6 bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-xl flex items-start gap-3 shadow-sm">
                          <AlertTriangle className="w-6 h-6 shrink-0 text-yellow-600" />
                          <div>
                              <h4 className="font-bold">Yerel (Çevrimdışı) Mod Aktif</h4>
                              <p className="text-sm mt-1">Sistem şu anda bir veritabanına bağlı değil. Yaptığınız kayıtlar sadece bu cihazın (PC/Telefon) hafızasında saklanır. <b>PC'de kaydettiğiniz bir öğrenciyi telefonda görememenizin sebebi budur.</b> Tüm cihazların aynı veriyi görmesi için Firebase ayarlarının aktif olması gerekir.</p>
                          </div>
                      </div>
                  )}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">Masa Yönetimi</h2>
                      <p className="text-sm text-slate-500">Müdahale için kroki üzerinden bir masaya tıklayın.</p>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <button onClick={() => {
                            const safeDesks = Array.isArray(desks) ? desks : [];
                            const maxId = safeDesks.reduce((max, d) => Math.max(max, d.id), 0);
                            const newId = maxId + 1;
                            const newDesk = {
                                id: newId,
                                status: 'available',
                                occupant: null,
                                breakEndTime: null,
                                reportEndTime: null,
                                sessionStartTime: null,
                                qrCode: 'QR-' + newId + '-' + generateId(),
                            };
                            setDesks(prev => [...(Array.isArray(prev) ? prev : []), newDesk]);
                            addLog('SİSTEM_AYAR', `Sisteme yeni masa (Masa ${newId}) eklendi.`);
                            showMessage("Masa Eklendi", `Masa ${newId} başarıyla eklendi.`, "success");
                        }} className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md font-bold flex items-center justify-center gap-2 transition-colors">
                            <Plus className="w-5 h-5"/> Masa Ekle
                        </button>
                        <button onClick={() => setScannerConfig({ isOpen: true, mode: 'admin_query', title: 'Masa QR Sorgula' })} className="flex-1 sm:flex-none px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl shadow-md font-bold flex items-center justify-center gap-2 transition-colors">
                          <QrCode className="w-5 h-5"/> QR Okut
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const ok = window.confirm(
                              'GÜN SONU TEMİZLİĞİ yapılsın mı?\n\n' +
                              '• Tüm aktif/rezerve masalar boşaltılır.\n' +
                              '• Tüm kullanıcıların aktif masa ve bekleyen rezervasyonları kapatılır.\n' +
                              '• Günlük ihlal sayaçları sıfırlanır.\n' +
                              '• Kalıcı İhlal Kayıtları SİLİNMEZ.\n' +
                              '• Temizlikten önce gün sonu yedeği alınır.\n\n' +
                              'Bu işlem gün içinde yalnızca gerektiğinde kullanılmalıdır.'
                            );
                            if (!ok) return;

                            const result = runFullDayCleanup({
                              source: 'manual',
                              cleanupTime: Date.now(),
                              dayKey: getLocalDayKey(),
                              dayLabel: new Date().toDateString(),
                              writeAutoCloseMarker: false
                            });

                            showMessage(
                              'Gün Sonu Temizliği Tamamlandı',
                              `${result.activeDeskCount} aktif/rezerve masa boşaltıldı. ${result.violationUserCount} kullanıcının günlük ihlali arşivlenip sıfırlandı. Temizlik öncesi yedek alındı; kalıcı İhlal Kayıtları korunuyor.`,
                              'success'
                            );
                          }}
                          className="flex-1 sm:flex-none px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md font-bold flex items-center justify-center gap-2 transition-colors"
                          title="Otomatik kapanışta sorun olursa tüm gün sonu temizliğini elle uygular"
                        >
                          <StopCircle className="w-5 h-5"/> Günü Kapat / Sıfırla
                        </button>
                    </div>
                  </div>
                  <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                      <p className="text-xs font-black uppercase tracking-wider text-slate-500 mb-2">Gösterilecek Kroki</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setAdminKrokiArea('main')}
                          className={`px-4 py-3 rounded-xl font-black transition-all ${adminKrokiArea === 'main' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'}`}
                        >
                          Ana Salon
                        </button>

                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                      <p className="text-xs font-black uppercase tracking-wider text-slate-500 mb-2">Halka Açık Ekranda Yayın</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            pushUndoSnapshot('Ana Salon kroki yayın durumu');
                            const nextValue = settings.showMainLibraryKroki === false;
                            setSettings(prev => ({ ...prev, showMainLibraryKroki: nextValue }));
                            addLog('SİSTEM_AYAR', `Ana Salon krokisi ${nextValue ? 'yayına açıldı' : 'yayından kaldırıldı'}.`);
                            showMessage('Kroki Güncellendi', `Ana Salon krokisi ${nextValue ? 'yayına açıldı' : 'halka açık ekrandan kaldırıldı'}.`, 'success');
                          }}
                          className={`px-4 py-3 rounded-xl font-bold border transition-all ${
                            settings.showMainLibraryKroki !== false
                              ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                              : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                          }`}
                        >
                          Ana Salon: {settings.showMainLibraryKroki !== false ? 'Yayında' : 'Kapalı'}
                        </button>

                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">Buradaki değişiklik Firebase üzerinden açık olan diğer cihazlara anlık yansır.</p>
                    </div>
                  </div>

                  <div className="w-full overflow-hidden">
                    {renderLiveKroki({
                      isAdmin: true,
                      area: adminKrokiArea,
                      showBlueRoom: true,
                      showMainLibrary: true,
                      onDeskClick: (desk) => {
                        setLiveDeskId(desk.id);
                        setModal({ isOpen: true, type: 'info', title: `Masa ${desk.id} Yönetimi`, content: null });
                      }
                    })}
                  </div>
                </div>
              )}

              {adminTab === 'layout_editor' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-200">
                        <h2 className="text-xl font-bold text-slate-800">Sürükle-Bırak Kroki Editörü</h2>
                    </div>
                    <LayoutEditor 
                        initialElements={layoutElements} 
                        onSave={(newLayout) => {
                            saveCustomLayoutImmediately(newLayout);
                        }} 
                    />
                </div>
              )}

              {adminTab === 'users' && (
                <div className="space-y-6">
                  {usersSyncError && <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl">{usersSyncError}</div>}
                  {(!app && !db) && <div className="bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-xl"><b>Veritabanı Bağlantısı Yok:</b> Sistem şu an yerel modda çalışıyor.</div>}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div><h2 className="text-xl font-black text-slate-800">Otomatik Kullanıcı Üretimi</h2><p className="text-sm text-slate-500 mt-1">GM Özel Kod ve 8 haneli şifre sistem tarafından otomatik ve benzersiz üretilir.</p></div>
                      <div className="flex flex-wrap gap-2">
                        <button disabled={adminCreatingUser} onClick={createAutomaticUser} className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold flex items-center gap-2"><Plus className="w-5 h-5"/> Yeni Kişi Oluştur</button>
                        <button onClick={undoLastAdminOperation} disabled={!getCurrentTabUndoSnapshot()} className="px-5 py-3 bg-amber-100 hover:bg-amber-200 disabled:bg-slate-100 disabled:text-slate-400 text-amber-800 rounded-xl font-bold flex items-center gap-2"><RefreshCw className="w-5 h-5"/> Geri Al</button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                    <div className="flex flex-col xl:flex-row justify-between xl:items-center mb-5 gap-4">
                      <div><h2 className="text-xl font-bold text-slate-800">Kayıtlı Kullanıcılar</h2><p className="text-xs text-slate-500 mt-1">Toplam: {Array.isArray(users) ? users.length : 0} · Seçili: {selectedUserIds.length}</p></div>
                      <div className="flex flex-wrap gap-2">


                        <label className="text-sm">Kısıt günü <input type="number" min="1" step="1" value={bulkRestrictionDays} onChange={e=>setBulkRestrictionDays(e.target.value)} className="w-16 border rounded p-2" /></label><button onClick={()=>bulkUserAction('block')} className="px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-bold">Kısıt Ver</button>
                        <button onClick={()=>bulkUserAction('unblock')} className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-bold">Kısıtı Kaldır</button>
                        <button disabled={!selectedUserIds.length} onClick={()=>bulkUserAction('delete')} className="px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-bold inline-flex items-center gap-2"><Trash2 className="w-4 h-4"/> Seçilenleri Sil ({selectedUserIds.length})</button>
                        <input type="file" id="import-users-input" accept=".json" style={{display:'none'}} onChange={handleImportUsers}/><button onClick={()=>document.getElementById('import-users-input').click()} className="px-3 py-2 bg-slate-100 rounded-lg text-sm font-bold">Yedek Yükle</button><button onClick={handleExportUsers} className="px-3 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-bold">Yedek İndir</button>
                      </div>
                    </div>
                    <div className="mb-4 space-y-2"><label htmlFor="user-search" className="block font-bold text-slate-700">Kullanıcı Ara</label><input id="user-search" type="search" value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="GM Özel Kod, şifre veya ad soyad yazın" className="w-full p-3 border rounded-xl"/><p className="text-xs text-slate-500">Bulunan: {filteredUsers.length} {userSearch && <button onClick={() => setUserSearch('')} className="ml-3 text-blue-700 font-bold">Aramayı temizle</button>}</p></div>
                    <table className="w-full text-left border-collapse text-sm min-w-[1100px]">
                      <thead><tr className="bg-slate-50 text-slate-500 border-b"><th className="p-3"><input type="checkbox" checked={filteredUsers.length > 0 && filteredUsers.every(u => selectedUserIds.includes(u.id))} onChange={e=>setSelectedUserIds(prev=>e.target.checked ? [...new Set([...prev, ...filteredUsers.map(u=>u.id)])] : prev.filter(id=>!filteredUsers.some(u=>u.id===id)))}/></th><th className="p-3">8 Haneli Şifre</th><th className="p-3">GM Özel Kod</th><th className="p-3">Hesap Durumu</th><th className="p-3">Aktif Masa</th><th className="p-3 text-center">İhlal</th><th className="p-3 text-center">İşlemler</th></tr></thead>
                      <tbody>{filteredUsers.map(u=><tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50"><td className="p-3"><input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={e=>setSelectedUserIds(prev=>e.target.checked?[...new Set([...prev,u.id])]:prev.filter(id=>id!==u.id))}/></td><td className="p-3 font-mono font-bold tracking-widest">{u.pin}</td><td className="p-3 font-mono font-black text-indigo-700 tracking-widest"><button onClick={() => openAdminUserEditor(u.id)} className="hover:underline">{u.specialCode || '-'}</button></td><td className="p-3">{u.blocked ? "Kısıtlı (Engelli)" : u.pendingApproval ? "Onay Bekliyor" : isRestricted(u, now) ? "Kısıtlı" : "Aktif"}<div className="text-xs text-slate-500 mt-1">İhbar: {isRestricted(u, now) ? "Hesap kısıtlı" : settings.reportsEnabled === false ? "Sistem genelinde kapalı" : u.canReport === false ? "Yetki kapalı" : "Açık"}</div></td><td className="p-3">{u.activeDeskId?`Masa ${u.activeDeskId}`:'Yok'}</td><td className="p-3 text-center text-red-600 font-bold">{u.strikes}</td><td className="p-3 text-center"><div className="flex flex-wrap justify-center gap-2"><button onClick={()=>openAdminUserEditor(u.id)} className="px-3 py-1 bg-blue-50 text-blue-700 rounded font-bold">Düzenle</button>{isRestricted(u, now) && <button disabled={adminUserSavingId !== null} onClick={()=>handleAdminAction('approve_account',null,u.id)} className="px-3 py-1 bg-green-50 text-green-700 rounded font-bold disabled:opacity-50">Hesabı Onayla / Kısıtı Kaldır</button>}<button onClick={()=>handleAdminAction('toggle_block',null,u.id)} className="px-3 py-1 bg-slate-100 rounded font-bold">{isRestricted(u)?'Kısıtlı':'Kısıt Ver'}</button><button onClick={()=>handleAdminAction('delete_user',null,u.id)} className="px-3 py-1 bg-red-50 text-red-600 rounded font-bold">Sil</button></div></td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {adminTab === 'registration' && <div className="max-w-3xl mx-auto bg-white p-6 rounded-2xl space-y-4">
                <h2 className="text-xl font-bold">Kayıt / Google Form Bağlantısı</h2>
                <p>Kayıt için yönlendirilecek Google Form bağlantısını kaydedin. Formu kontrol edip kullanıcıyı GM Özel Koduyla bulun ve kısıtını kaldırın.</p>
                <form key={settings.registrationFormUrl} className="space-y-3" onSubmit={saveRegistrationFormUrl}>
                  <label className="block">Google Form bağlantısı<input name="formUrl" type="url" required defaultValue={settings.registrationFormUrl || ''} placeholder="https://forms.gle/..." className="w-full p-3 border rounded-xl"/></label>
                  <button disabled={registrationLinkSaving} className="px-5 py-3 bg-blue-600 disabled:opacity-50 text-white rounded-xl">{registrationLinkSaving ? 'Kaydediliyor…' : 'Bağlantıyı Kaydet'}</button>
                </form>
                {settings.registrationFormUrl && <a href={settings.registrationFormUrl} target="_blank" rel="noopener noreferrer" className="block text-blue-700 break-all">{settings.registrationFormUrl}</a>}
                <p className="text-sm font-bold text-amber-800">Kayıt formuna GM özel kodunu yazmayı unutmayın.</p>
                <div className="border-t pt-4 space-y-3"><h3 className="font-bold">Eski Bağlantılar</h3>
                  {!(settings.registrationFormHistory || []).length && <p className="text-sm text-slate-500">Henüz değiştirilmiş bağlantı yok.</p>}
                  {(settings.registrationFormHistory || []).map((item, index) => <div key={`${item.changedAt}-${index}`} className="p-3 bg-slate-50 border rounded-xl"><a href={item.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 break-all">{item.url}</a><p className="text-xs text-slate-500 mt-1">Değiştirildi: {new Date(item.changedAt).toLocaleString('tr-TR')}</p></div>)}
                </div>
              </div>}

              {adminTab === 'settings' && (
                <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                  <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2"><Settings className="text-blue-600"/> Sistem Ayarları</h2>
                  <form key={stableJson(settings)} onSubmit={async (e) => {
                     e.preventDefault();
                     if (systemSettingsSavingRef.current) return;
                     const formData = new FormData(e.currentTarget);
                     if (db) {
                       try {
                         await ensureTabAuthPersistence(); await auth.authStateReady();
                         const liveUser = auth.currentUser;
                         if (!liveUser) throw new Error('Yönetici oturumu bulunamadı.');
                         const token = await liveUser.getIdTokenResult(true);
                         if (auth.currentUser?.uid !== liveUser.uid || token.claims.admin !== true) throw new Error('Yönetici yetkisi doğrulanamadı.');
                         verifiedAdminUidRef.current = liveUser.uid;
                         setFbUser(liveUser); setAdminAuthorized(true);
                       } catch (error) {
                         return showMessage('Ayarlar Kaydedilemedi', error.message, 'warning');
                       }
                     }
                     pushUndoSnapshot('Sistem ayarlarını kaydetme');
                     const previousOpenTime = String(settings.openTime || DEFAULT_SETTINGS.openTime);
                     const previousCloseTime = String(settings.closeTime || DEFAULT_SETTINGS.closeTime);
                     const nextOpenTime = String(formData.get('openTime') || DEFAULT_SETTINGS.openTime);
                     const nextCloseTime = String(formData.get('closeTime') || DEFAULT_SETTINGS.closeTime);

                     const settingsPatch = {
                        openTime: nextOpenTime,
                        closeTime: nextCloseTime,
                        shortBreakCount: parseInt(formData.get('shortBreakCount')),
                        longBreakCount: parseInt(formData.get('longBreakCount')),
                        shortBreakDuration: parseInt(formData.get('shortBreakDuration')),
                        longBreakDuration: parseInt(formData.get('longBreakDuration')),
                        breakCooldown: Math.max(30, Number.isFinite(parseInt(formData.get('breakCooldown'))) ? parseInt(formData.get('breakCooldown')) : 30),
                        reportWaitTime: Number.isFinite(parseInt(formData.get('reportWaitTime'))) && parseInt(formData.get('reportWaitTime')) > 0 ? parseInt(formData.get('reportWaitTime')) : 5,
                        strikeLimit: Number.isFinite(parseInt(formData.get('strikeLimit'))) && parseInt(formData.get('strikeLimit')) > 0 ? parseInt(formData.get('strikeLimit')) : DEFAULT_SETTINGS.strikeLimit,
                        reportsEnabled: true,
                        useCustomLayout: formData.get('useCustomLayout') === 'on'
                     };

                     systemSettingsSavingRef.current = true;
                     setSystemSettingsSaving(true);
                     try {
                       // Bekleyen eski yazıları tamamla; yeni ayarları gecikmeden sunucuya yaz.
                       if (granularWriteTimerRef.current) {
                         clearTimeout(granularWriteTimerRef.current);
                         granularWriteTimerRef.current = null;
                       }
                       const save = granularWriteChainRef.current.catch(() => {}).then(async () => {
                         let previousSettings = settingsRef.current;
                         const ref = db ? getLiveSettingsDoc() : null;
                         const next = db ? await runTransaction(db, async tx => {
                           const snap = await tx.get(ref);
                           const base = snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.data() } : settingsRef.current;
                           previousSettings = base;
                           tx.set(ref, settingsPatch, { merge: true });
                           return { ...base, ...settingsPatch };
                         }) : {...settingsRef.current, ...settingsPatch};
                         granularBaselineRef.current.settings = stableJson(next);
                         settingsRef.current = next;
                         setSettings(next);
                         if (previousSettings.shortBreakCount !== next.shortBreakCount || previousSettings.longBreakCount !== next.longBreakCount) {
                           for (const localUser of [...usersRef.current]) {
                             const user = db ? await runTransaction(db, async tx => {
                               const userRef = getLiveDoc('sgmUsers', localUser.id);
                               const snapshot = await tx.get(userRef);
                               if (!snapshot.exists()) return null;
                               const remote = {...snapshot.data(), id: localUser.id};
                               const breaks = updatedBreakAllowance(remote, previousSettings, next);
                               tx.set(userRef, {breaks}, {merge: true});
                               return {...remote, breaks};
                             }) : {...localUser, breaks: updatedBreakAllowance(localUser, previousSettings, next)};
                             if (user) applyCloudRows({user});
                           }
                         }
                         return next;
                       });
                       granularWriteChainRef.current = save.catch(() => {});
                       await save;

                     // Çalışma saatlerindeki değişiklikleri sistem kayıtlarına ayrıca yaz.
                     if (previousCloseTime !== nextCloseTime) {
                       addLog(
                         'KAPANIS_SAATI_GUNCELLENDI',
                         `Kütüphane kapanış saati ${previousCloseTime} → ${nextCloseTime} olarak güncellendi. 1 saat, 30 dakika ve 15 dakika kapanış bildirimleri yeni saate göre otomatik hesaplanacaktır.`,
                         null,
                         null,
                         false,
                         null,
                         { oldCloseTime: previousCloseTime, newCloseTime: nextCloseTime }
                       );
                     }

                     if (previousOpenTime !== nextOpenTime) {
                       addLog(
                         'ACILIS_SAATI_GUNCELLENDI',
                         `Kütüphane açılış saati ${previousOpenTime} → ${nextOpenTime} olarak güncellendi.`,
                         null,
                         null,
                         false,
                         null,
                         { oldOpenTime: previousOpenTime, newOpenTime: nextOpenTime }
                       );
                     }

                     showMessage("Başarılı", "Sistem ayarları sunucuya kaydedildi. Öğrenci ekranları güncel saatleri anlık alacaktır.", "success");
                     } catch (error) {
                       handleFirestoreQuotaError(error);
                       showMessage('Ayarlar Kaydedilemedi', 'Ayarlar sunucuya kaydedilemedi. İnternet bağlantısını ve sunucu izinlerini kontrol edip tekrar deneyin.', 'warning');
                     } finally {
                       systemSettingsSavingRef.current = false;
                       setSystemSettingsSaving(false);
                     }
                  }} className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-600 mb-1">Açılış Saati</label>
                        <input type="time" name="openTime" defaultValue={settings.openTime} className="w-full p-3 border border-slate-300 rounded-xl bg-slate-50" />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-600 mb-1">Kapanış Saati</label>
                        <input type="time" name="closeTime" defaultValue={settings.closeTime} className="w-full p-3 border border-slate-300 rounded-xl bg-slate-50" />
                      </div>
                    </div>
                    
                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-4">
                      <h3 className="font-bold text-blue-800 mb-2">Mola Ayarları</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Kısa Mola Sayısı</label>
                          <input type="number" name="shortBreakCount" defaultValue={settings.shortBreakCount} className="w-full p-2 border border-slate-300 rounded-lg" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Kısa Süre (Dk)</label>
                          <input type="number" name="shortBreakDuration" defaultValue={settings.shortBreakDuration} className="w-full p-2 border border-slate-300 rounded-lg" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Uzun Mola Sayısı</label>
                          <input type="number" name="longBreakCount" defaultValue={settings.longBreakCount} className="w-full p-2 border border-slate-300 rounded-lg" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Uzun Süre (Dk)</label>
                          <input type="number" name="longBreakDuration" defaultValue={settings.longBreakDuration} className="w-full p-2 border border-slate-300 rounded-lg" />
                        </div>
                      </div>
                      <div className="pt-3 border-t border-blue-200">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Molalar Arası Zorunlu Çalışma (Dk)</label>
                        <input type="number" min="30" name="breakCooldown" defaultValue={Math.max(30, Number(settings.breakCooldown) || 30)} className="w-full p-2 border border-blue-300 rounded-lg bg-white" />
                        <p className="text-xs text-blue-700 mt-1">Peş peşe mola kullanılamaz. Minimum değer 30 dakikadır ve süre masa başlangıcında veya mola dönüşünde yeniden başlar.</p>
                      </div>
                    </div>

                    

                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                        <div>
                            <h3 className="font-bold text-slate-800">Özel Kroki Görünümü</h3>
                            <p className="text-xs text-slate-500">Editörden çizdiğiniz dinamik düzeni etkinleştirir.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" name="useCustomLayout" defaultChecked={settings.useCustomLayout} className="sr-only peer" />
                          <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl space-y-3">
                      <h3 className="font-bold text-orange-800">Boş Masa İhbarı</h3>
                      <p className="text-sm text-orange-800">Sistem genelinde açık. Hesabı onaylı ve kısıtsız öğrenciler, mola dışında masada bulunmayan kullanıcıyı ihbar edebilir. Tamamen boş masalar ve moladaki kullanıcılar ihbar edilemez.</p>
                      <label className="block text-xs font-semibold text-slate-600">İhbar doğrulama süresi (dakika)
                        <input type="number" name="reportWaitTime" min="1" defaultValue={settings.reportWaitTime} className="w-full p-2 border rounded-lg mt-1" />
                      </label>
                      <label className="block text-xs font-semibold text-slate-600">İhlal sınırı
                        <input type="number" name="strikeLimit" min="1" defaultValue={settings.strikeLimit} className="w-full p-2 border rounded-lg mt-1" />
                      </label>
                    </div>
                    <button type="submit" disabled={systemSettingsSaving} className="w-full bg-slate-800 text-white font-bold py-4 rounded-xl shadow-md hover:bg-slate-900 transition-colors disabled:opacity-50">{systemSettingsSaving ? 'Kaydediliyor…' : 'Ayarları Kaydet'}</button>
                  </form>
                </div>
              )}

              

              {adminTab === 'violations' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-red-600"/> İhlal Kayıtları</h2>
                      <p className="text-sm text-slate-500 mt-1">Günlük ihlal sayacı yeni günde sıfırlanır; bu arşiv geçmiş ihlalleri tarih-saat bilgisiyle saklamaya devam eder.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setSelectedViolationIds((Array.isArray(violationRecords) ? violationRecords : []).map(r => r.id))} disabled={!Array.isArray(violationRecords) || violationRecords.length === 0} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-sm font-bold">Tümünü Seç</button>
                      <button type="button" onClick={() => setSelectedViolationIds([])} disabled={selectedViolationIds.length === 0} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-sm font-bold">Seçimi Kaldır</button>
                      <button type="button" onClick={() => bulkDeleteRecords('violations')} disabled={selectedViolationIds.length === 0} className="px-3 py-2 bg-red-700 hover:bg-red-800 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2"><Trash2 className="w-4 h-4"/> Seçilenleri Sil ({selectedViolationIds.length})</button>
                      <button onClick={downloadViolationRecordsPdf} disabled={!Array.isArray(violationRecords) || violationRecords.length === 0} className="px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2"><FileText className="w-4 h-4"/> PDF İndir</button>
                      <button onClick={downloadViolationRecordsWord} disabled={!Array.isArray(violationRecords) || violationRecords.length === 0} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2"><FileText className="w-4 h-4"/> Word İndir</button>
                      <div className="px-3 py-2 bg-red-50 text-red-700 rounded-xl text-sm font-bold border border-red-200">Toplam: {Array.isArray(violationRecords) ? violationRecords.length : 0}</div>
                    </div>
                  </div>

                  {!Array.isArray(violationRecords) || violationRecords.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                      <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto mb-3"/>
                      <p className="font-bold text-slate-500">Henüz kayıtlı ihlal bulunmuyor.</p>
                      <p className="text-xs text-slate-400 mt-1">Bir öğrenci ihlal aldığında burada otomatik kaydedilecektir.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-sm min-w-[1100px]">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                          <th className="p-3 font-semibold text-center">Seç</th>
                          <th className="p-3 font-semibold">Tarih / Saat</th>
                          <th className="p-3 font-semibold">Öğrenci</th>
                          <th className="p-3 font-semibold">Masa</th>
                          <th className="p-3 font-semibold">İhlal Türü</th>
                          <th className="p-3 font-semibold w-1/3">Açıklama</th>
                          <th className="p-3 font-semibold">Cihaz / Konum</th>
                          <th className="p-3 font-semibold text-center">İşlem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {violationRecords.map(record => (
                          <tr key={record.id} className="border-b border-slate-100 hover:bg-red-50/30 align-top">
                            <td className="p-3 text-center"><input type="checkbox" checked={selectedViolationIds.includes(record.id)} onChange={e => setSelectedViolationIds(prev => e.target.checked ? [...new Set([...prev, record.id])] : prev.filter(id => id !== record.id))} /></td>
                            <td className="p-3 whitespace-nowrap text-slate-500">
                              <div className="font-semibold text-slate-700">{new Date(record.time).toLocaleDateString('tr-TR')}</div>
                              <div className="text-xs">{formatDateTime(record.time)}</div>
                            </td>
                            <td className="p-3">
                              <div className="font-bold text-slate-700">{record.userId ? <button type="button" onClick={() => openAdminUserEditor(record.userId)} className="text-blue-700 hover:underline text-left">{record.userInfo || '-'}</button> : (record.userInfo || '-')}</div>
                              {record.userId && <div className="text-[11px] text-slate-400 mt-1">ID: {record.userId}</div>}
                            </td>
                            <td className="p-3">{record.deskId ? <span className="px-2 py-1 bg-slate-200 rounded-lg text-xs font-bold">{record.deskId}</span> : '-'}</td>
                            <td className="p-3"><span className="px-2 py-1 bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-black">{String(record.type || 'IHLAL').replace(/_/g, ' ')}</span></td>
                            <td className="p-3 text-slate-600">{record.message || '-'}</td>
                            <td className="p-3">
                              <div className="text-xs space-y-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                <div className="text-slate-500 font-medium flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5"/> {record.deviceInfo || '-'}</div>
                                {record.locationInfo && <div className="text-slate-500 font-medium flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5"/> {record.locationInfo}</div>}
                              </div>
                            </td>
                            <td className="p-3 text-center">
                              <button onClick={() => deleteViolationRecord(record)} className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 rounded-lg font-bold inline-flex items-center gap-1.5 whitespace-nowrap"><Trash2 className="w-4 h-4"/> Sil</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {adminTab === 'feedback' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><FileText className="w-5 h-5 text-purple-600"/> Dilek / Şikayet Kayıtları</h2>
                      <p className="text-sm text-slate-500 mt-1">Onaylanmış ve kısıtsız hesaplardan gönderilen tüm öneri ve şikayetler burada listelenir.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setSelectedFeedbackIds((Array.isArray(feedbackRecords) ? feedbackRecords : []).map(r => r.id))} disabled={!Array.isArray(feedbackRecords) || feedbackRecords.length === 0} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-sm font-bold">Tümünü Seç</button>
                      <button type="button" onClick={() => setSelectedFeedbackIds([])} disabled={selectedFeedbackIds.length === 0} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-sm font-bold">Seçimi Kaldır</button>
                      <button type="button" onClick={() => bulkDeleteRecords('feedback')} disabled={selectedFeedbackIds.length === 0} className="px-3 py-2 bg-red-700 hover:bg-red-800 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2"><Trash2 className="w-4 h-4"/> Seçilenleri Sil ({selectedFeedbackIds.length})</button>
                      <button onClick={downloadFeedbackRecordsPdf} disabled={!Array.isArray(feedbackRecords) || feedbackRecords.length === 0} className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2"><FileText className="w-4 h-4"/> PDF İndir</button>
                      <button onClick={downloadFeedbackRecordsWord} disabled={!Array.isArray(feedbackRecords) || feedbackRecords.length === 0} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2"><FileText className="w-4 h-4"/> Word İndir</button>
                      <div className="px-3 py-2 bg-purple-50 text-purple-700 rounded-xl text-sm font-bold border border-purple-200">Toplam: {Array.isArray(feedbackRecords) ? feedbackRecords.length : 0}</div>
                    </div>
                  </div>

                  {!Array.isArray(feedbackRecords) || feedbackRecords.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                      <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3"/>
                      <p className="font-bold text-slate-500">Henüz dilek, öneri veya şikayet kaydı bulunmuyor.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-sm min-w-[950px]">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                          <th className="p-3 font-semibold text-center">Seç</th>
                          <th className="p-3 font-semibold">Tarih / Saat</th>
                          <th className="p-3 font-semibold">Ad Soyad</th>
                          <th className="p-3 font-semibold">GM Özel Kod</th>
                          <th className="p-3 font-semibold">Tür</th>
                          <th className="p-3 font-semibold w-2/5">Mesaj</th>
                          <th className="p-3 font-semibold text-center">İşlem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feedbackRecords.map(record => (
                          <tr key={record.id} className="border-b border-slate-100 hover:bg-purple-50/30 align-top">
                            <td className="p-3 text-center"><input type="checkbox" checked={selectedFeedbackIds.includes(record.id)} onChange={e => setSelectedFeedbackIds(prev => e.target.checked ? [...new Set([...prev, record.id])] : prev.filter(id => id !== record.id))} /></td>
                            <td className="p-3 whitespace-nowrap text-slate-500">
                              <div className="font-semibold text-slate-700">{new Date(record.time).toLocaleDateString('tr-TR')}</div>
                              <div className="text-xs">{formatDateTime(record.time)}</div>
                            </td>
                            <td className="p-3 font-bold text-slate-700">{record.name || '-'}</td>
                            <td className="p-3 text-slate-600">{record.specialCode || safeUsersList.find(u => u.id === record.userId)?.specialCode || '-'}</td>
                            <td className="p-3">
                              <span className={`px-3 py-1 rounded-full text-xs font-black ${record.type === 'complaint' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                {record.type === 'complaint' ? 'ŞİKAYET' : 'ÖNERİ'}
                              </span>
                            </td>
                            <td className="p-3 text-slate-600 whitespace-pre-wrap">{record.message || '-'}</td>
                            <td className="p-3 text-center">
                              <button onClick={() => deleteFeedbackRecord(record)} className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 rounded-lg font-bold inline-flex items-center gap-1.5 whitespace-nowrap"><Trash2 className="w-4 h-4"/> Sil</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {adminTab === 'logs' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                   <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                     <div>
                       <h2 className="text-xl font-bold text-slate-800">Sistem Kayıtları</h2>
                       <p className="text-sm text-slate-500 mt-1">Kayıtları tek tek silebilir, son 7 gün veya son 30 gün kayıtlarını Excel uyumlu CSV olarak indirebilirsiniz.</p>
                       <p className="text-xs text-blue-600 mt-1 font-semibold">22:00 otomatik kapanış, 23:00 ikinci güvenlik kontrolü, otomatik masa boşaltma ve günlük ihlal arşiv/sıfırlama işlemleri de burada loglanır.</p>
                     </div>
                     <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                       <button onClick={() => downloadLogsCsv('week')} className="px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-xl text-sm font-bold flex items-center justify-center gap-2 border border-green-200">
                         <Save className="w-4 h-4"/> Haftalık Kayıtları İndir
                       </button>
                       <button onClick={() => downloadLogsCsv('month')} className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-xl text-sm font-bold flex items-center justify-center gap-2 border border-blue-200">
                         <Save className="w-4 h-4"/> Aylık Kayıtları İndir
                       </button>
                     </div>
                   </div>
                   <div className="flex flex-wrap gap-2 mb-4">
                     <button onClick={() => setSelectedLogIds(visibleLogs.map(l => l.id))} className="px-3 py-2 bg-slate-100 rounded-xl font-bold">Tümünü Seç</button>
                     <button onClick={() => setSelectedLogIds([])} className="px-3 py-2 bg-slate-100 rounded-xl font-bold">Seçimi Kaldır</button>
                     <button disabled={!selectedLogIds.length} onClick={() => bulkDeleteRecords('logs')} className="px-3 py-2 bg-red-700 disabled:bg-slate-300 text-white rounded-xl font-bold">Seçilenleri Sil ({selectedLogIds.length})</button>
                     <button disabled={archiveLoading} onClick={loadArchivedLogs} className="px-3 py-2 bg-blue-50 text-blue-700 rounded-xl font-bold">{archiveLoading ? 'Yükleniyor...' : 'Eski Kayıtları Yükle'}</button>
                   </div>
                   {visibleLogs.length === 0 ? (
                      <p className="text-slate-400 text-center py-8">Henüz kayıt bulunmuyor.</p>
                   ) : (
                      <table className="w-full text-left border-collapse text-sm min-w-[1050px]">
                        <thead>
                           <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                             <th className="p-3 font-semibold text-center">Seç</th><th className="p-3 font-semibold">Zaman</th>
                             <th className="p-3 font-semibold">İşlem Tipi</th>
                             <th className="p-3 font-semibold">Masa</th>
                             <th className="p-3 font-semibold w-1/4">Açıklama</th>
                             <th className="p-3 font-semibold">Kullanıcı & Cihaz</th>
                             <th className="p-3 font-semibold text-center">İşlem</th>
                           </tr>
                        </thead>
                        <tbody>
                           {visibleLogs.map(log => (
                              <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                                 <td className="p-3 text-center"><input type="checkbox" aria-label="Kaydı seç" checked={selectedLogIds.includes(log.id)} onChange={e => setSelectedLogIds(prev => e.target.checked ? [...new Set([...prev, log.id])] : prev.filter(id => id !== log.id))}/></td><td className="p-3 whitespace-nowrap text-slate-500">
                                   <div>{new Date(log.time).toLocaleDateString('tr-TR')}</div>
                                   <div className="text-xs">{formatDateTime(log.time)}</div>
                                 </td>
                                 <td className="p-3 font-bold text-slate-700">{String(log.type || 'KAYIT').replace(/_/g, ' ')}</td>
                                 <td className="p-3">{log.deskId ? <span className="px-2 py-0.5 bg-slate-200 rounded text-xs font-bold">{log.deskId}</span> : '-'}</td>
                                 <td className="p-3 text-slate-600 pr-4">{log.message || '-'}</td>
                                 <td className="p-3">
                                    <div className="text-xs space-y-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                        <div className="text-blue-700 font-bold flex items-center gap-1.5"><User className="w-3.5 h-3.5"/> {log.userInfo}</div>
                                        <div className="text-slate-500 font-medium flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5"/> {log.deviceInfo}</div>
                                        {log.locationInfo && <div className="text-slate-500 font-medium flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5"/> {log.locationInfo}</div>}
                                    </div>
                                 </td>
                                 <td className="p-3 text-center">
                                   <button onClick={() => deleteSystemLog(log)} className="px-3 py-2 rounded-lg text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 inline-flex items-center gap-1.5">
                                     <Trash2 className="w-4 h-4"/> Sil
                                   </button>
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                      </table>
                   )}
                </div>
              )}

              {adminTab === 'push_status' && (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                          <Smartphone className="w-6 h-6 text-blue-600" />
                          Telefon Push Bildirim Durumu
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                          Bu ekran FCM, Service Worker, VAPID ve Vercel Push API bağlantısını kontrol eder.
                        </p>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={forceRegisterMessagingWorker}
                          disabled={manualWorkerBusy}
                          className="px-5 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-md"
                        >
                          <Smartphone className="w-5 h-5" />
                          {manualWorkerBusy ? 'Worker Kaydediliyor...' : 'Service Worker’ı Zorla Kaydet'}
                        </button>

                      <button
                        type="button"
                        onClick={refreshPushDiagnostics}
                        disabled={pushDiagnostics.loading}
                        className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-md"
                      >
                        <RefreshCw className={`w-5 h-5 ${pushDiagnostics.loading ? 'animate-spin' : ''}`} />
                        {pushDiagnostics.loading ? 'Kontrol Ediliyor...' : 'Sistemi Kontrol Et'}
                      </button>
                      </div>
                    </div>

                    {!pushDiagnostics.checked ? (
                      <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
                        <b>Sistemi Kontrol Et</b> butonuna basarak bu cihazın push bildirim durumunu kontrol edin.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {[
                          {
                            label: 'Bildirim Desteği',
                            ok: pushDiagnostics.notificationSupported,
                            value: pushDiagnostics.notificationSupported ? 'Destekleniyor' : 'Desteklenmiyor'
                          },
                          {
                            label: 'Bildirim İzni',
                            ok: pushDiagnostics.notificationPermission === 'granted',
                            value:
                              pushDiagnostics.notificationPermission === 'granted'
                                ? 'Açık'
                                : pushDiagnostics.notificationPermission === 'denied'
                                  ? 'Engellendi'
                                  : pushDiagnostics.notificationPermission === 'default'
                                    ? 'Henüz Verilmedi'
                                    : pushDiagnostics.notificationPermission
                          },
                          {
                            label: 'FCM Messaging',
                            ok: pushDiagnostics.messagingSupported,
                            value: pushDiagnostics.messagingSupported ? 'Destekleniyor' : 'Desteklenmiyor'
                          },
                          {
                            label: 'Service Worker',
                            ok: pushDiagnostics.serviceWorkerSupported && pushDiagnostics.serviceWorkerActive,
                            value: !pushDiagnostics.serviceWorkerSupported
                              ? 'Desteklenmiyor'
                              : pushDiagnostics.serviceWorkerActive
                                ? 'Aktif'
                                : 'FCM Worker Bulunamadı'
                          },
                          {
                            label: 'VAPID Anahtarı',
                            ok: pushDiagnostics.vapidConfigured,
                            value: pushDiagnostics.vapidConfigured ? 'Tanımlı' : 'Eksik'
                          },
                          {
                            label: 'Vercel Push API',
                            ok: pushDiagnostics.apiReachable,
                            value: pushDiagnostics.apiReachable
                              ? `Aktif${pushDiagnostics.apiStatus ? ` (HTTP ${pushDiagnostics.apiStatus})` : ''}`
                              : `Hata${pushDiagnostics.apiStatus ? ` (HTTP ${pushDiagnostics.apiStatus})` : ''}`
                          }
                        ].map(item => (
                          <div
                            key={item.label}
                            className={`p-4 rounded-xl border ${item.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}
                          >
                            <div className="flex items-start gap-3">
                              {item.ok
                                ? <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
                                : <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
                              }
                              <div>
                                <p className="font-bold text-slate-800">{item.label}</p>
                                <p className={`text-sm mt-1 ${item.ok ? 'text-green-700' : 'text-red-700'}`}>
                                  {item.value}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {pushDiagnostics.checked && pushDiagnostics.apiMessage && (
                      <div className="mt-4 text-xs text-slate-500">
                        API cevabı: <b>{pushDiagnostics.apiMessage}</b>
                        {pushDiagnostics.lastCheckedAt && (
                          <> · Son kontrol: {new Date(pushDiagnostics.lastCheckedAt).toLocaleTimeString('tr-TR')}</>
                        )}
                      </div>
                    )}

                    {pushDiagnostics.manualWorkerResult && (
                      <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800 break-all">
                        <b>Manuel Worker Sonucu:</b> {pushDiagnostics.manualWorkerResult}
                      </div>
                    )}

                    {pushDiagnostics.manualWorkerError && (
                      <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 break-all">
                        <b>Manuel Worker Hatası:</b> {pushDiagnostics.manualWorkerError}
                      </div>
                    )}
                  </div>

                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">Kullanıcı FCM Tokenları</h3>
                        <p className="text-sm text-slate-500 mt-1">
                          Telefonda bildirim izni verip giriş yapan kullanıcıların kayıtlı tokenlarını burada görebilirsiniz.
                        </p>
                      </div>

                      <div className="px-3 py-2 bg-slate-100 rounded-xl text-sm font-bold text-slate-700">
                        Tokenı olan kullanıcı:
                        {' '}
                        {Array.isArray(users)
                          ? users.filter(u => Array.isArray(u.pushTokens) && u.pushTokens.some(Boolean)).length
                          : 0}
                      </div>
                    </div>

                    {!Array.isArray(users) || users.length === 0 ? (
                      <p className="text-slate-400 text-center py-8">Henüz kullanıcı bulunmuyor.</p>
                    ) : (
                      <div className="space-y-3">
                        {users.map(user => {
                          const tokenCount = Array.isArray(user.pushTokens)
                            ? user.pushTokens.filter(Boolean).length
                            : 0;
                          const hasToken = tokenCount > 0;

                          return (
                            <div
                              key={user.id}
                              className="border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-bold text-slate-800">{user.name || 'İsimsiz Kullanıcı'}</p>
                                  <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${hasToken ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {hasToken ? `FCM Aktif · ${tokenCount} token` : 'FCM Token Yok'}
                                  </span>
                                </div>

                                <p className="text-xs text-slate-500 mt-1">
                                  GM Özel Kod: {user.specialCode || '-'}
                                  {user.activeDeskId ? ` · Masa ${user.activeDeskId}` : ''}
                                </p>

                                {user.pushUpdatedAt && (
                                  <p className="text-xs text-slate-400 mt-1">
                                    Son push kaydı: {new Date(user.pushUpdatedAt).toLocaleString('tr-TR')}
                                  </p>
                                )}
                              </div>

                              <button
                                type="button"
                                disabled={!hasToken || pushTestSendingUserId === user.id}
                                onClick={() => sendAdminTestPush(user)}
                                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shrink-0"
                              >
                                {pushTestSendingUserId === user.id
                                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                                  : <Smartphone className="w-4 h-4" />
                                }
                                {pushTestSendingUserId === user.id ? 'Gönderiliyor...' : 'Test Bildirimi Gönder'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {adminTab === 'qr_print' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center mb-6 gap-4 print:hidden">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">Toplu QR Kodları</h2>
                      <p className="text-sm text-slate-500 mt-1">
                        İstediğiniz masaları seçip yalnızca seçilen QR kodlarını yazdırabilir veya her masanın QR kodunu PNG olarak alabilirsiniz.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={deskQrRepairBusy} onClick={() => repairDeskQrData(true)} className="px-4 py-2 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 text-amber-800 rounded-xl font-bold">
                        {deskQrRepairBusy ? 'Kontrol Ediliyor…' : 'Eksik Masaları / QR Kodlarını Onar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const allIds = (Array.isArray(desks) ? desks : []).map(d => Number(d.id));
                          const allSelected = allIds.length > 0 && allIds.every(id => selectedQrDeskIds.includes(id));
                          setSelectedQrDeskIds(allSelected ? [] : allIds);
                        }}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold"
                      >
                        {(Array.isArray(desks) && desks.length > 0 && desks.every(d => selectedQrDeskIds.includes(Number(d.id))))
                          ? 'Seçimi Kaldır'
                          : 'Tüm Masaları Seç'}
                      </button>
                      <button
                        type="button"
                        onClick={handlePrintQRs}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md font-bold flex items-center gap-2"
                      >
                        <QrCode className="w-5 h-5"/>
                        {selectedQrDeskIds.length ? `Seçilenleri Yazdır (${selectedQrDeskIds.length})` : 'Tümünü Yazdır'}
                      </button>
                    </div>
                  </div>

                  <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl print:hidden">
                    <p className="text-sm font-bold text-blue-800">
                      Masa seçimi: {selectedQrDeskIds.length} masa seçili.
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                      Kartın sol üstündeki kutudan masa seçebilirsiniz. “QR İndir” ile tek masanın QR görselini bilgisayarınıza alabilirsiniz.
                    </p>
                  </div>

                  {(!Array.isArray(desks) || desks.length === 0) && (
                    <div className="mb-5 p-6 bg-amber-50 border border-amber-200 rounded-xl text-center">
                      <QrCode className="w-10 h-10 text-amber-500 mx-auto mb-2"/>
                      <p className="font-bold text-amber-800">QR oluşturulacak masa bulunamadı.</p>
                      <p className="text-sm text-amber-700 mt-1">Önce Kroki bölümünde masaların yüklendiğini kontrol edin.</p>
                    </div>
                  )}

                  <div id="qr-print-area" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                     {Array.isArray(desks) && desks.map(desk => {
                       const selected = selectedQrDeskIds.includes(Number(desk.id));
                       return (
                        <div key={desk.id} className={`relative flex flex-col items-center justify-center p-0 border-2 rounded-xl bg-white overflow-hidden shadow-sm ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-300'}`}>
                           <label className="absolute top-2 left-2 z-10 print:hidden bg-white/95 rounded-lg px-2 py-1 shadow border border-slate-200 flex items-center gap-1.5 cursor-pointer">
                             <input
                               type="checkbox"
                               checked={selected}
                               onChange={() => setSelectedQrDeskIds(prev =>
                                 prev.includes(Number(desk.id))
                                   ? prev.filter(id => id !== Number(desk.id))
                                   : [...prev, Number(desk.id)]
                               )}
                               className="w-4 h-4 accent-blue-600"
                             />
                             <span className="text-[10px] font-black text-slate-700">SEÇ</span>
                           </label>
                           <div className="bg-slate-800 w-full text-center py-2 border-b-2 border-slate-300">
                               <p className="text-[11px] font-bold text-white uppercase tracking-wide">Sarıçam Gençlik Merkezi</p>
                           </div>
                           <div className="p-4 flex flex-col items-center w-full bg-slate-50">
                               <p className="text-2xl font-black text-slate-800 mb-3">Masa {desk.id}</p>
                               {desk.qrCode ? (
                                 <>
                                   <div className="bg-white p-2 rounded-xl shadow-sm border border-slate-200 mb-3">
                                       <img src={getDeskQrImageUrl(desk, 300)} alt={`Masa ${desk.id} QR`} className="w-28 h-28" />
                                   </div>
                                   <p className="text-[10px] text-slate-500 font-mono break-all text-center leading-tight bg-white px-2 py-1 rounded w-full border border-slate-200">{desk.qrCode}</p>
                                   <button
                                     type="button"
                                     onClick={() => handleDownloadDeskQR(desk)}
                                     className="mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1 print:hidden"
                                   >
                                     <QrCode className="w-4 h-4"/> QR İndir
                                   </button>
                                 </>
                               ) : (
                                 <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
                                   <p className="text-xs font-bold text-amber-800">QR kod yok</p>
                                   <p className="text-[10px] text-amber-700 mt-1">Kroki → Masa {desk.id} → QR Kodunu Yenile</p>
                                 </div>
                               )}
                           </div>
                        </div>
                       );
                     })}
                  </div>
                </div>
              )}

            </main>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { height: 6px; width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      `}</style>
      
      {renderView()}
      <div title={`Derleme: ${BUILD_COMMIT}`} className="fixed bottom-1 right-2 z-10 text-[10px] text-slate-400 pointer-events-none">Sürüm {APP_VERSION}</div>
      
      <ScannerModal 
        isOpen={scannerConfig.isOpen} 
        title={scannerConfig.title}
        onClose={() => setScannerConfig({ isOpen: false, mode: null })}
        autoSubmit={scannerConfig.mode === 'verify'}
        onScan={(qrData) => {
          if (scannerConfig.mode === 'claim') claimDesk(qrData);
          else if (scannerConfig.mode === 'verify') handleVerifyImHere(qrData);
          else if (scannerConfig.mode === 'return_break') returnFromBreak(qrData);
          else if (scannerConfig.mode === 'report') handleReportScan(qrData);
          else if (scannerConfig.mode === 'admin_query') handleAdminQueryScan(qrData);
        }} 
      />
      
      <Modal isOpen={modal.isOpen} onClose={modal.onClose} title={modal.title} type={modal.type}>
        {/* Masa kontrol içeriği yalnızca gerçek masa-kontrol modali açıkken gösterilir.
            Mesaj gibi alt modaller modal.content taşıdığı için artık masa kontrol ekranı
            bu formların üstünü ezmez. Böylece PC ve telefonda aynı akış çalışır. */}
        {adminUserEditId && modal.content == null ? (
           renderAdminUserEditorContent(adminUserEditId)
        ) : liveDeskId && adminTab === 'desks' && modal.content == null ? (
           renderAdminDeskContent(liveDeskId)
        ) : (
           typeof modal.content === 'string' ? (
             <div className="space-y-6">
               <p className="text-slate-600 text-[15px] whitespace-pre-wrap">{modal.content}</p>
               <button onClick={closeMessage} className="w-full bg-slate-800 text-white font-bold py-3 rounded-xl hover:bg-slate-900 transition-colors">Tamam</button>
             </div>
           ) : modal.content
        )}
      </Modal>

      <Modal isOpen={showRules} onClose={() => setShowRules(false)} title="Kütüphane Kullanım Kuralları" type="info">
        <div className="space-y-4 text-sm text-slate-700 pb-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="text-center">
            <h2 className="font-black text-xl text-slate-900">SARIÇAM GENÇLİK MERKEZİ</h2>
            <p className="text-slate-500 mt-1 font-medium">Kütüphane Kullanım Kuralları</p>
          </div>
          <div className="space-y-3 pt-3">
            {[
              <>Kütüphane kullanım saatleri <b>07.00 - 22.00</b> arasındadır.</>,
              <>Kütüphaneyi kullanacak öğrencilerin sisteme kayıtlı olması gerekmektedir.</>,
              <>Her öğrenci aynı anda yalnızca <b>bir masa</b> kullanabilir.</>,
              <>Masa kullanımını başlatmak için masada bulunan <b>QR kodun okutulması</b> zorunludur.</>,
              <>Mola süresince masa kullanıcı adına ayrılmış olarak kalır.</>,
              <>Moladan erken dönmek isteyen kullanıcı, kendi masasındaki <b>QR kodu yeniden okutmalıdır.</b></>,
              <>Mola süresi dolduğu halde masaya dönmeyen kullanıcıların masa oturumu sistem tarafından sonlandırılabilir ve kural ihlali uygulanabilir.</>,
              <>Boş bırakıldığı düşünülen masalar sistem üzerinden ihbar edilebilir.</>,
              <>Masa sahibi ihbar aldıktan sonra belirtilen süre içerisinde kendi masasındaki QR kodu okutarak masada olduğunu doğrulamalıdır.</>,
              <>Asılsız ihbar, başka öğrencilerin kullanımını engelleme ve sistemin kötüye kullanılması yasaktır.</>,
              <>Kurallara uymayan kullanıcıların erişimi yönetici tarafından geçici veya sürekli olarak kısıtlanabilir. Kısıtlı hesaplar <b>masa seçemez, boş masa ihbarı ve dilek / şikayet gönderemez.</b></>,
              <>Kütüphaneden ayrılırken kullanılan masanın sistem üzerinden bırakılması gerekmektedir. Masayı bıraktıktan sonra <b>30 dakika</b> boyunca yeniden masa alınamaz. Sistem hatasında yönetici masa atayabilir.</>
            ].map((rule, index) => {
              const danger = index === 9 || index === 10;
              return (
                <div key={index} className={`flex gap-3 p-3 border rounded-xl ${danger ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`font-black ${danger ? 'text-red-600' : 'text-blue-600'}`}>{index + 1}.</span>
                  <p>{rule}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="font-bold text-center italic text-slate-700">
              Kütüphaneyi kullanan herkes bu kurallara uymayı kabul etmiş sayılır.
            </p>
          </div>
        </div>
        <button onClick={() => {setShowRules(false);setRegistrationRulesOpen(false);}} className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md transition-colors">
          {registrationRulesOpen ? 'Kapat' : 'Okudum, Anladım'}
        </button>
        {registrationRulesOpen && <div className="mt-3 space-y-3"><label className="flex gap-2"><input type="checkbox" checked={registrationAccepted} onChange={e=>setRegistrationAccepted(e.target.checked)}/> Kütüphane kurallarını okudum ve kabul ediyorum.</label><button disabled={!registrationAccepted || registrationBusy} onClick={startRegistration} className="w-full py-3 bg-green-600 disabled:opacity-40 text-white rounded-xl font-bold">{registrationBusy?'Hesap Oluşturuluyor…':'Kuralları Onayla ve Hesabımı Oluştur'}</button>{registrationError && <p className="text-red-700">{registrationError}</p>}</div>}

      </Modal>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
