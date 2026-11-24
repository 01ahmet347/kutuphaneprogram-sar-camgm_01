import React, { useEffect, useState } from 'react';
import { CalendarCheck, RefreshCw, Lock, Trash2 } from 'lucide-react';
import { istanbulDayKey } from './break-policy.js';
import { isActivityPhase } from './activity-phase.js';

const btn='rounded-xl px-3 py-2 font-bold disabled:opacity-40 disabled:cursor-not-allowed';
const fmt=t=>t?new Date(Number(t)).toLocaleString('tr-TR'):'—';
const remaining=(at,now)=>{
  const secs=Math.max(0,Math.ceil((Number(at||0)-now)/1000));
  return `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`;
};
async function studentActivityRequest(auth,action,params={}) {
  const user=auth?.currentUser;
  if(!user) throw new Error('Öğrenci oturumu bulunamadı.');
  const token=await user.getIdToken();
  const response=await fetch('/api/student-activity',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({action,...params})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok) throw new Error(data.message||'Faaliyet işlemi tamamlanamadı.');
  return data.result;
}
export function StudentActivityWidget({auth,user,desk,now=Date.now()}) {
  const [open,setOpen]=useState(false),[data,setData]=useState({activities:[],application:null});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async(silent=true)=>{
    if(!auth?.currentUser||!user?.id)return;
    try {const result=await studentActivityRequest(auth,'activity_list');setData(result);if(!silent)setError('');}
    catch(e){if(!silent)setError(e.message);}
  };
  useEffect(()=>{load();const timer=setInterval(()=>load(),30000);return()=>clearInterval(timer);},[user?.id,auth]);
  useEffect(()=>{if(open)load(false);},[open]);
  const run=async(action,params,confirmation)=>{
    if(confirmation&&!window.confirm(confirmation))return;
    setBusy(true);setError('');setNotice('');
    try{await studentActivityRequest(auth,action,params);setNotice('İşlem başarıyla kaydedildi.');await load(false);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  if(!user?.id)return null;
  const a=data.application;
  const active=a?.status==='approved' && desk?.status==='on_break' && desk?.breakType==='activity' &&
    String(desk?.breakSessionId)===`activity-${a.id}`;
  const pending=a?.status==='pending';
  const used=user.activityUsedDay===istanbulDayKey(now) || a?.status==='approved';
  return <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-indigo-900"><CalendarCheck size={19}/><b>Faaliyet</b>
        {pending&&<span className="text-xs bg-amber-100 text-amber-900 rounded-full px-2 py-1">Onay Bekliyor</span>}
        {active&&<span className={`text-xs rounded-full px-2 py-1 ${isActivityPhase(desk,now)?'bg-violet-600 text-white':'bg-amber-100 text-amber-900'}`}>{isActivityPhase(desk,now)?'FAALİYETTE':'EK MOLADA'}</span>}
      </div>
      <button className={`${btn} bg-indigo-600 text-white`} type="button" onClick={()=>setOpen(!open)}>{open?'Kapat':'Faaliyet'}</button>
    </div>
    {pending&&<p className="text-sm text-amber-900">Lider onayını bekleyiniz. Onay verilmeden masanızdan ayrılmayınız; normal masa kuralları devam eder.</p>}
    {active&&<p className="text-sm text-indigo-900 font-semibold">{a.title} · Kalan süre: {remaining(desk.breakEndTime,now)} {a.extraBreakType?'· Ek mola eklendi':''}</p>}
    {open&&<div className="bg-white border rounded-xl p-3 space-y-3 text-sm">
      {error&&<p role="alert" className="text-red-700">{error}</p>}
      {notice&&<p className="text-green-700">{notice}</p>}
      {a?.status==='rejected'&&<p className="text-amber-700">Önceki başvurunuz reddedildi. Açık bir faaliyete yeniden başvurabilirsiniz.</p>}
      {pending&&<p>Başvurunuz: <b>{a.title}</b> · {a.leaderName}. Onay beklerken masa aktif kalır.</p>}
      {a?.status==='approved'&&!active&&<p>Bugünkü faaliyet hakkınız kullanıldı. Yeni faaliyet başvurusu yapılamaz.</p>}
      {active&&<div className="space-y-2">
        <p>Faaliyet 60 dakika sürer. İsterseniz mevcut 15 veya 30 dakikalık tek normal mola hakkınızı ekleyebilirsiniz. Cuma günkü 60 dakikalık mola eklenemez.</p>
        {a.extraBreakType?<p className="font-semibold text-indigo-700">Ek mola eklendi; aynı faaliyete ikinci mola eklenemez.</p>:
          <div className="flex flex-wrap gap-2">
            <button disabled={busy||Number(user.breaks?.short||0)<1||Number(desk.breakEndTime)<=now} className={`${btn} bg-amber-100 text-amber-900`} onClick={()=>run('activity_append_break',{type:'short'},'Faaliyete kısa mola hakkınız eklensin mi? Günlük 1 birleştirme hakkı kullanılacak.')}>+15 dk mola</button>
            <button disabled={busy||Number(user.breaks?.long||0)<1||Number(desk.breakEndTime)<=now} className={`${btn} bg-blue-100 text-blue-900`} onClick={()=>run('activity_append_break',{type:'long'},'Faaliyete uzun mola hakkınız eklensin mi? Günlük 1 birleştirme hakkı kullanılacak.')}>+30 dk mola</button>
          </div>}
      </div>}
      {!pending&&!used&&desk?.status==='occupied'&&<div className="space-y-2">
        <p className="font-semibold">Bugünün açık faaliyetleri</p>
        {data.activities.map(item=><div key={item.id} className="border rounded-lg p-3 flex items-center justify-between gap-3">
          <div><b>{item.title}</b><p className="text-slate-600">Lider: {item.leaderName} · {item.startTime}</p></div>
          <button className={`${btn} bg-indigo-600 text-white`} disabled={busy} onClick={()=>run('activity_apply',{activityId:item.id},`${item.leaderName} liderinin ${item.title} faaliyetine başvurulsun mu?`)}>Seç</button>
        </div>)}
        {!data.activities.length&&<p className="text-slate-500">Şu anda başvuruya açık faaliyet bulunmuyor.</p>}
      </div>}
      {!desk&&<p className="text-amber-800">Faaliyet için önce bir masa almalısınız.</p>}
      <button type="button" className={`${btn} bg-slate-100 flex items-center gap-1`} disabled={busy} onClick={()=>load(false)}><RefreshCw size={15}/> Yenile</button>
    </div>}
  </div>;
}
export function LeaderActivities({call}) {
  const [data,setData]=useState({activities:[],applications:[]}),[title,setTitle]=useState(''),[startTime,setStartTime]=useState('14:00');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async()=>{try{setData(await call('leader_activity_list'));}catch(e){setError(e.message);}};
  useEffect(()=>{load();},[]);
  const run=async(action,params,confirmText)=>{
    if(confirmText&&!window.confirm(confirmText))return;
    setBusy(true);setError('');setNotice('');
    try{await call(action,params);setNotice('İşlem kaydedildi.');await load();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="bg-white border rounded-2xl p-5 space-y-4">
    <div className="flex justify-between gap-2"><h2 className="font-black text-lg flex items-center gap-2"><CalendarCheck/> Faaliyet Oluştur / Etkinlik Onay</h2><button className={`${btn} bg-slate-100`} onClick={load} disabled={busy}><RefreshCw size={16}/></button></div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p className="text-green-700">{notice}</p>}
    <form className="flex flex-wrap gap-2 items-end" onSubmit={e=>{e.preventDefault();run('leader_activity_create',{title,startTime});setTitle('');}}>
      <label className="flex-1 min-w-[180px] text-sm font-semibold">Faaliyet adı<input className="w-full border rounded-lg p-2 mt-1" required minLength={3} maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Robotik Kodlama Atölyesi"/></label>
      <label className="text-sm font-semibold">Başlangıç saati<input type="time" className="w-full border rounded-lg p-2 mt-1" value={startTime} onChange={e=>setStartTime(e.target.value)} required/></label>
      <button className={`${btn} bg-blue-600 text-white`} disabled={busy}>Faaliyet Oluştur</button>
    </form>
    {data.activities.map(activity=>{
      const rows=data.applications.filter(a=>a.activityId===activity.id);
      return <div key={activity.id} className="border rounded-xl p-3 space-y-3">
        <div className="flex justify-between gap-2 flex-wrap"><div><b>{activity.title}</b><p className="text-xs text-slate-500">{activity.startTime} · Onay: {activity.approvedCount} · Bekleyen: {activity.pendingCount}</p></div>
          <div className="flex gap-2 flex-wrap"><button disabled={busy||activity.status!=='open'||activity.pendingCount>0} className={`${btn} bg-slate-800 text-white flex items-center gap-1`} onClick={()=>run('leader_activity_close',{activityId:activity.id},'Yeni başvurular kapatılsın mı? Onaylı öğrencilerin süreleri devam edecek.')}><Lock size={15}/>{activity.status==='closed'?'Başvurular Kapalı':'Başvuruları Kapat'}</button>
          <button type="button" disabled={busy||activity.status==='removed'||activity.removalRequest?.status==='pending'} className={`${btn} bg-red-100 text-red-800 flex items-center gap-1`} onClick={()=>{const reason=window.prompt('Faaliyetin kaldırılma gerekçesi (ana yönetici onaylayacak):');if(reason!==null&&reason.trim().length>=5)run(data.canRemoveActivities ? 'leader_activity_remove' : 'leader_activity_remove_request',{activityId:activity.id,reason:reason.trim()},data.canRemoveActivities ? 'Faaliyet kayıt geçmişi korunarak doğrudan kaldırılsın mı? Aktif öğrenci süreleri devam edecek.' : 'Kaldırma isteği ana yönetici paneline gönderilsin mi? Öğrencilerin aktif süreleri etkilenmeyecek.');else if(reason!==null)setError('En az 5 karakter gerekçe yazınız.');}}><Trash2 size={15}/>{activity.removalRequest?.status==='pending'?'Yönetici Onayı Bekleniyor':(data.canRemoveActivities?'Faaliyeti Kaldır':'Kaldırma Talebi')}</button></div></div>
        {activity.status==='removed'&&<p className="text-sm text-red-700">Bu faaliyet kaldırıldı; kayıt ve onay geçmişi korundu.</p>}
        {activity.removalRequest?.status==='rejected'&&<p className="text-sm text-amber-700">Önceki kaldırma talebi yönetici tarafından reddedildi.</p>}
        {activity.pendingCount>0&&<p className="text-amber-800 text-sm">Başvuruları kapatmadan önce bekleyen öğrencileri onaylayın veya reddedin.</p>}
        {rows.map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"><span><b>{a.studentName}</b> · GM: {a.studentCode} · Masa {a.deskId} · {a.status==='pending'?'Onay Bekliyor':a.status==='approved'?'Faaliyette / Onaylandı':'Reddedildi'}</span>
          {a.status==='pending'&&<div className="flex gap-2"><button className={`${btn} bg-red-100 text-red-700`} disabled={busy} onClick={()=>run('leader_activity_decide',{applicationId:a.id,decision:'reject'},'Başvuru reddedilsin mi?')}>Reddet</button><button className={`${btn} bg-green-600 text-white`} disabled={busy} onClick={()=>run('leader_activity_decide',{applicationId:a.id,decision:'approve'},'Onayla dediğiniz anda 60 dakika başlayacak. Öğrenci faaliyete hazır mı?')}>Onayla</button></div>}
        </div>)}
      </div>;
    })}
    {!data.activities.length&&<p className="text-slate-500 text-sm">Bugün henüz faaliyet oluşturulmadı.</p>}
  </section>;
}
export function AdminActivities({call}) {
  const [data,setData]=useState({activities:[],applications:[],history:[]}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const load=async()=>{setBusy(true);try{setData(await call('admin_activity_list'));setError('');}catch(e){setError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{load();},[]);
  const adminAction=async(action,params,confirmText)=>{
    if(!window.confirm(confirmText))return;
    setBusy(true);setError('');setNotice('');
    try{await call(action,params);setNotice('İşlem kayıt geçmişi korunarak tamamlandı.');await load();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="bg-white border rounded-2xl p-5 space-y-4">
    <div className="flex justify-between items-center gap-2"><h2 className="text-xl font-black">Faaliyet Yönetimi</h2><button disabled={busy} className={`${btn} bg-slate-100`} onClick={load}><RefreshCw size={17}/></button></div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p className="text-green-700">{notice}</p>}
    <p className="text-sm text-slate-600">Tüm liderler ve öğrenciler · Bugünün faaliyetleri. Kayıtlar silinmez.</p>
    <div className="grid sm:grid-cols-3 gap-2">{[['Faaliyet',data.activities.length],['Onaylanan',data.applications.filter(a=>a.status==='approved').length],['Bekleyen',data.applications.filter(a=>a.status==='pending').length]].map(([label,value])=><div key={label} className="bg-slate-50 rounded-xl p-3"><b className="text-2xl">{value}</b><p className="text-xs text-slate-600">{label}</p></div>)}</div>
    {data.activities.map(a=><div key={a.id} className="border rounded-xl p-3 space-y-2"><b>{a.title}</b> · {a.leaderName} · {a.startTime} · {a.status==='open'?'Başvuru Açık':a.status==='removed'?'Kaldırıldı':'Başvuru Kapalı'}
      <p className="text-sm">Onaylanan: {a.approvedCount} · Bekleyen: {a.pendingCount} · Reddedilen: {a.rejectedCount}</p>
      {a.removalRequest?.status==='pending'&&<div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2"><b>Kaldırma onayı bekleniyor</b><p className="text-sm">Talep eden: {a.removalRequest.leaderName} · Gerekçe: {a.removalRequest.reason}</p><div className="flex flex-wrap gap-2"><button className={`${btn} bg-red-700 text-white`} disabled={busy||a.pendingCount>0} onClick={()=>adminAction('admin_activity_remove_decide',{activityId:a.id,decision:'approve'},'Faaliyet listeden kaldırılacak. Aktif öğrencilerin sayaçları ve geçmiş kayıtları korunacak. Onaylıyor musunuz?')}>Kaldırmayı Onayla</button><button className={`${btn} bg-slate-200`} disabled={busy} onClick={()=>adminAction('admin_activity_remove_decide',{activityId:a.id,decision:'reject'},'Liderin kaldırma talebi reddedilsin mi?')}>Talebi Reddet</button></div>{a.pendingCount>0&&<p className="text-xs text-amber-800">Önce bekleyen başvurular sonuçlandırılmalı.</p>}</div>}
      {a.status!=='removed'&&<button type="button" className={`${btn} bg-red-100 text-red-800 flex items-center gap-1`} disabled={busy||a.pendingCount>0} onClick={()=>{const reason=window.prompt('Yönetici kaldırma gerekçesi:');if(reason!==null&&reason.trim().length>=5)adminAction('admin_activity_remove',{activityId:a.id,reason:reason.trim()},'Bu faaliyet kayıtları silinmeden listeden kaldırılacak. Onaylıyor musunuz?');else if(reason!==null)setError('En az 5 karakter gerekçe yazınız.');}}><Trash2 size={15}/> Yönetici Olarak Kaldır</button>}
      {a.status==='removed'&&<p className="text-sm text-red-700">Kaldırıldı · {fmt(a.removedAt)} · {a.removedBy}. Onaylı öğrencilerin oturumları ve işlem geçmişi korunur.</p>}
      {data.applications.filter(x=>x.activityId===a.id).map(x=><div key={x.id} className="text-xs border-t py-2">{x.studentName} · GM {x.studentCode} · Masa {x.deskId} · {x.status} · Onaylayan: {x.decidedBy||'—'} · Onay: {fmt(x.decidedAt)} · Bitiş: {fmt(x.endAt)} · Ek mola: {x.extraBreakType||'Yok'}</div>)}
    </div>)}
    <h3 className="font-bold">Son işlem geçmişi</h3>
    <div className="max-h-64 overflow-auto text-xs">{data.history.map(h=><p key={h.id} className="border-b py-1">{fmt(h.at)} · {h.action} · Lider: {h.leaderId||'—'} · Öğrenci: {h.userId||'—'}</p>)}</div>
  </section>;
}
