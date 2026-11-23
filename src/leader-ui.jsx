import React, { useEffect, useState } from 'react';
import { LeaderActivities } from './activity-ui.jsx';
import { Shield, ArrowLeft, RefreshCw, CheckCircle, AlertTriangle, Lock, Users, History, ExternalLink } from 'lucide-react';

const dateTime = value => value ? new Date(Number(value)).toLocaleString('tr-TR') : '—';
const btn = 'px-4 py-2.5 rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'w-full border border-slate-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500';

export function LeaderLogin({onBack,onLogin}) {
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const submit=async event=>{
    event.preventDefault();setBusy(true);setError('');
    try {
      const response=await fetch('/api/admin-login',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({role:'leader',username,password})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload?.token) throw new Error(payload.message||'Lider girişi başarısız.');
      await onLogin(payload);
    } catch(err){setError(err.message||'Bağlantı hatası.');}
    finally {setBusy(false);}
  };
  return <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
    <form onSubmit={submit} className="bg-white max-w-md w-full rounded-3xl shadow-xl border p-7 space-y-5">
      <button type="button" onClick={onBack} className="text-slate-500 flex items-center gap-2"><ArrowLeft size={18}/> Geri</button>
      <div className="flex gap-3 items-center"><Shield className="text-blue-600" size={33}/>
        <div><h1 className="text-2xl font-black">Gençlik Lideri Girişi</h1><p className="text-sm text-slate-500">Sarıçam GM Kütüphane Sistemi</p></div></div>
      <label className="block font-semibold">Kullanıcı adı<input className={`${input} mt-1`} value={username} autoComplete="username" onChange={e=>setUsername(e.target.value.toLowerCase())} required/></label>
      <label className="block font-semibold">Şifre<input type="password" className={`${input} mt-1`} value={password} autoComplete="current-password" onChange={e=>setPassword(e.target.value)} required/></label>
      {error && <p className="text-red-700 bg-red-50 rounded-xl p-3" role="alert">{error}</p>}
      <button className={`${btn} w-full bg-blue-600 text-white`} disabled={busy}>{busy?'Giriş yapılıyor…':'Lider Paneline Giriş Yap'}</button>
    </form>
  </main>;
}

async function leaderRequest(auth,action,params={}) {
  const current=auth?.currentUser;
  if(!current) throw new Error('Lider oturumu bulunamadı. Yeniden giriş yapın.');
  const token=await current.getIdToken();
  const response=await fetch('/api/admin-maintenance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action,...params})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.ok) throw new Error(payload.message||'İşlem tamamlanamadı.');
  return payload.result;
}

export function LeaderDashboard({auth,leader,onExit}) {
  const [queue,setQueue]=useState([]),[history,setHistory]=useState([]);
  const [links,setLinks]=useState({});
  const [deviceRequests,setDeviceRequests]=useState([]);
  const [filter,setFilter]=useState(''),[selected,setSelected]=useState(null);
  const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async()=>{
    setBusy(true);setError('');
    try {
      const [result,log]=await Promise.all([leaderRequest(auth,'leader_queue'),leaderRequest(auth,'leader_history')]);
      setQueue(result.students||[]);setLinks(result);setHistory(log.history||[]);setDeviceRequests(result.deviceRequests||[]);
      if(selected) setSelected((result.students||[]).find(x=>x.id===selected.id)||null);
    } catch(e){setError(e.message);} finally{setBusy(false);}
  };
  useEffect(()=>{load();},[]);
  const act=async action=>{
    if(!selected) return;
    if(action==='leader_restrict' && (!confirmed||reason.trim().length<8)) return;
    if(!window.confirm(action==='leader_restrict'?'Öğrencinin hesabı hemen kısıtlanacak ve aktif masası boşaltılacak. Onaylıyor musunuz?':action==='leader_unrestrict'?'Yalnızca form bilgisi kısıtını kaldırmak istiyor musunuz?':'Bilgileri kontrol edildi olarak işaretlemek istiyor musunuz?')) return;
    setBusy(true);setError('');setNotice('');
    try {
      await leaderRequest(auth,action,{userId:selected.id,reason:reason.trim()});
      setNotice('İşlem kaydedildi. Yönetici işlem geçmişinde görünecek.');setReason('');setConfirmed(false);
      await load();
    } catch(e){setError(e.message);} finally{setBusy(false);}
  };
  const visible=queue.filter(u=>(u.name+' '+u.specialCode).toLocaleLowerCase('tr-TR').includes(filter.toLocaleLowerCase('tr-TR')));
  return <main className="min-h-screen bg-slate-100 p-4 md:p-7">
    <div className="max-w-6xl mx-auto space-y-5">
      <header className="bg-slate-900 text-white p-5 rounded-2xl flex flex-wrap gap-4 items-center justify-between">
        <div><h1 className="text-xl font-black flex items-center gap-2"><Shield/> Gençlik Lideri Paneli</h1><p className="text-sm text-slate-300">{leader?.name||'Lider'} · Kayıt kontrolü ve faaliyet onayı</p></div>
        <div className="flex gap-2"><button className={`${btn} bg-white/10`} onClick={load} disabled={busy}><RefreshCw size={16}/></button><button className={`${btn} bg-red-600`} onClick={onExit}>Çıkış</button></div>
      </header>
      {error && <p role="alert" className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-xl">{error}</p>}
      {notice && <p className="bg-green-50 border border-green-200 text-green-800 p-3 rounded-xl">{notice}</p>}
      <section className="bg-white border rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <b>Form bağlantıları:</b>
        {links.formUrl ? <a className="text-blue-700 underline inline-flex gap-1 items-center" href={links.formUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Ana Google Form</a>:<span className="text-amber-700">Ana form ayarlanmamış</span>}
        {links.codeListUrl ? <a className="text-blue-700 underline inline-flex gap-1 items-center" href={links.codeListUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> GM Özel Kod Listesi</a>:<span className="text-amber-700">Kod listesi ayarlanmamış</span>}
        <p className="w-full text-xs text-slate-500">Google belgelerine erişim, ilgili Google hesabına ayrıca verilmiş izinlere bağlıdır.</p>
      </section>
      <LeaderActivities call={(action,params)=>leaderRequest(auth,action,params)}/>
      <section className="bg-white border rounded-2xl p-4 space-y-3">
        <h2 className="font-bold text-lg">Cihaz Değişikliği Onayları</h2>
        <p className="text-sm text-slate-500">Yalnızca yeni kayıt sistemine dahil öğrenciler. Eski hesaplar etkilenmez. Aktif masası olan öğrenci için onay verilmez.</p>
        {!deviceRequests.length && <p className="text-sm text-slate-500">Bekleyen cihaz değişikliği yok.</p>}
        {deviceRequests.map(item=><div key={item.userId} className="flex flex-wrap gap-3 items-center justify-between border rounded-xl p-3">
          <div><b>{item.studentName}</b><p className="text-xs text-slate-500">GM: {item.specialCode} · {dateTime(item.requestedAt)}</p></div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={`${btn} bg-red-100 text-red-700`} onClick={async()=>{
              if(!window.confirm('Bu cihaz değişikliği reddedilsin mi?'))return;
              setBusy(true);setError('');try{await leaderRequest(auth,'leader_device_decide',{userId:item.userId,decision:'reject'});await load();}catch(e){setError(e.message);}finally{setBusy(false);}
            }}>Reddet</button>
            <button type="button" disabled={busy} className={`${btn} bg-green-600 text-white`} onClick={async()=>{
              if(!window.confirm('Öğrencinin yeni cihazını onaylıyor musunuz? Eski cihazın giriş hakkı kaldırılır.'))return;
              setBusy(true);setError('');try{await leaderRequest(auth,'leader_device_decide',{userId:item.userId,decision:'approve'});await load();}catch(e){setError(e.message);}finally{setBusy(false);}
            }}>Yeni Cihazı Onayla</button>
          </div>
        </div>)}
      </section>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Metric label="İncelenecek" number={queue.filter(u=>u.formVerified && u.reviewStatus==='pending').length}/>
        <Metric label="Kontrol edilen" number={queue.filter(u=>u.reviewStatus==='reviewed').length}/>
        <Metric label="Bilgi hatası kısıtlı" number={queue.filter(u=>u.formInfoRestricted).length}/>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white rounded-2xl p-5 border space-y-3">
          <h2 className="text-lg font-black flex items-center gap-2"><Users/> Kayıt Kontrolü</h2>
          <input className={input} value={filter} placeholder="GM Özel Kod veya öğrenci adı ara" onChange={e=>setFilter(e.target.value)}/>
          <div className="max-h-[28rem] overflow-y-auto space-y-2">
            {visible.map(u=><button key={u.id} onClick={()=>{setSelected(u);setReason('');setConfirmed(false);setNotice('');}} className={`w-full text-left rounded-xl p-3 border ${selected?.id===u.id?'bg-blue-50 border-blue-400':'bg-slate-50'}`}>
              <div className="font-semibold">{u.name}</div><div className="text-sm text-slate-500">GM: {u.specialCode} · {u.formInfoRestricted?'Bilgi hatası kısıtlı':u.formVerified?(u.reviewStatus==='reviewed'?'Kontrol edildi':'Kontrol bekliyor'):'Form bekleniyor'}</div>
            </button>)}
            {!visible.length && <p className="text-sm text-slate-500 p-3">Kayıt bulunamadı. Liste en yeni 150 kaydı gösterir.</p>}
          </div>
        </section>
        <section className="bg-white border rounded-2xl p-5 space-y-4">
          <h2 className="text-lg font-black flex items-center gap-2"><CheckCircle/> Öğrenci Denetimi</h2>
          {!selected ? <p className="text-slate-500">Soldan öğrenci seçin.</p> : <>
            <div className="bg-slate-50 p-4 rounded-xl space-y-1">
              <p className="font-bold">{selected.name}</p><p className="text-sm">GM Özel Kod: {selected.specialCode}</p>
              <p className="text-sm">Form: {selected.formVerified?'Gönderim doğrulandı':'Henüz doğrulanmadı'}</p>
              <p className="text-sm">Son kontrol: {dateTime(selected.reviewedAt)} {selected.reviewedBy&&`(${selected.reviewedBy})`}</p>
              {selected.formInfoRestricted && <p className="text-red-700 text-sm">Kısıt nedeni: {selected.formInfoRestrictionReason}</p>}
            </div>
            {!selected.formVerified && <p className="text-amber-800 bg-amber-50 p-3 rounded-xl">Form gönderimi doğrulanmadan kontrol veya kısıt işlemi yapılamaz.</p>}
            {selected.formVerified && <>
              <button className={`${btn} bg-green-600 text-white w-full`} disabled={busy||selected.formInfoRestricted} onClick={()=>act('leader_check')}>Bilgiler Doğru – Kontrol Edildi</button>
              {selected.formInfoRestricted ?
                <button className={`${btn} bg-blue-700 text-white w-full`} disabled={busy} onClick={()=>act('leader_unrestrict')}><Lock size={16} className="inline"/> Düzeltilen Bilgileri Doğruladım – Kısıtı Kaldır</button>
                : <div className="space-y-3 border border-red-200 rounded-xl p-3">
                    <label className="font-semibold text-red-800">Bilgi hatası nedeniyle kısıtla</label>
                    <textarea className={input} rows={3} maxLength={350} placeholder="Öğrenciye gösterilecek açıklayıcı mesaj (zorunlu)" value={reason} onChange={e=>setReason(e.target.value)} />
                    <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Form bilgilerini kontrol ettim; öğrencinin aktif masasının hemen boşalacağını biliyorum.</label>
                    <button className={`${btn} bg-red-600 text-white w-full`} disabled={busy||!confirmed||reason.trim().length<8} onClick={()=>act('leader_restrict')}><AlertTriangle size={16} className="inline"/> Mesaj Gönder ve Kısıtla</button>
                  </div>}
            </>}
          </>}
        </section>
      </div>
      <section className="bg-white border rounded-2xl p-5"><h2 className="text-lg font-black flex gap-2 items-center mb-3"><History/> Kendi İşlem Geçmişim</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-2">Tarih</th><th className="p-2">Öğrenci</th><th className="p-2">İşlem</th><th className="p-2">Gerekçe</th></tr></thead><tbody>
          {history.map(row=><tr key={row.id} className="border-b"><td className="p-2">{dateTime(row.at)}</td><td className="p-2">{row.studentName} · {row.studentCode}</td><td className="p-2">{({leader_check:'Kontrol edildi',leader_restrict:'Kısıt uygulandı',leader_unrestrict:'Kısıt kaldırıldı',leader_device_approve:'Cihaz değişikliği onaylandı',leader_device_reject:'Cihaz değişikliği reddedildi'})[row.action]||row.action}</td><td className="p-2">{row.reason||'—'}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  </main>;
}
function Metric({label,number}) {return <div className="rounded-2xl border bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="text-3xl font-bold">{number}</p></div>;}

export function AdminLeaderManager({call}) {
  const [leaders,setLeaders]=useState([]),[history,setHistory]=useState([]);
  const [form,setForm]=useState({name:'',username:'',password:'',confirm:''});
  const [passwordUser,setPasswordUser]=useState(''),[newPassword,setNewPassword]=useState('');
  const [links,setLinks]=useState({formUrl:'',codeListUrl:''});
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{
    setBusy(true);setError('');
    try {
      const [accounts,audit,config]=await Promise.all([call('admin_leader_list'),call('admin_leader_history'),call('admin_leader_config')]);
      setLeaders(accounts.leaders||[]);setHistory(audit.history||[]);setLinks(config);
    } catch(err){setError(err.message);} finally{setBusy(false);}
  };
  useEffect(()=>{load();},[]);
  const perform=async(action,payload={},confirmation)=>{
    if(confirmation&&!window.confirm(confirmation))return;
    setBusy(true);setError('');setNotice('');
    try {await call(action,payload);setNotice('İşlem başarıyla kaydedildi.');await load();}
    catch(err){setError(err.message);} finally{setBusy(false);}
  };
  const add=async(e)=>{
    e.preventDefault();if(form.password!==form.confirm){setError('Şifre tekrarı uyuşmuyor.');return;}
    await perform('admin_leader_create',{name:form.name,username:form.username.toLowerCase(),password:form.password});
    setForm({name:'',username:'',password:'',confirm:''});
  };
  return <div className="space-y-5">
    <header className="bg-white rounded-2xl p-5 border flex items-center justify-between gap-3"><div><h2 className="text-xl font-black">Lider Yönetimi</h2><p className="text-slate-500 text-sm">Liderlerin ayrı hesabı, form bağlantıları ve denetim geçmişi</p></div><button className={`${btn} bg-slate-100`} disabled={busy} onClick={load}><RefreshCw size={18}/></button></header>
    {error&&<p role="alert" className="bg-red-50 text-red-800 border border-red-200 p-3 rounded-xl">{error}</p>}
    {notice&&<p className="bg-green-50 text-green-800 border border-green-200 p-3 rounded-xl">{notice}</p>}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <form onSubmit={add} className="bg-white rounded-2xl p-5 border space-y-3">
        <h3 className="font-black text-lg">Yeni Lider Ekle</h3>
        <label className="block text-sm font-semibold">Ad Soyad<input className={`${input} mt-1`} required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label className="block text-sm font-semibold">Kullanıcı adı<input className={`${input} mt-1`} required pattern="[a-z0-9._-]{3,48}" value={form.username} onChange={e=>setForm({...form,username:e.target.value.toLowerCase()})}/></label>
        <label className="block text-sm font-semibold">Yeni şifre (en az 12 karakter)<input type="password" className={`${input} mt-1`} required minLength={12} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
        <label className="block text-sm font-semibold">Şifre tekrarı<input type="password" className={`${input} mt-1`} required minLength={12} value={form.confirm} onChange={e=>setForm({...form,confirm:e.target.value})}/></label>
        <button className={`${btn} w-full bg-blue-600 text-white`} disabled={busy}>Lider Hesabı Oluştur</button>
        <p className="text-xs text-slate-500">Şifreler yalnızca güvenli özet biçiminde saklanır. Liderlerin disiplin veya masa yönetimi yetkisi yoktur.</p>
      </form>
      <div className="bg-white rounded-2xl p-5 border space-y-3"><h3 className="font-black text-lg">Form Bağlantıları</h3>
        <label className="block text-sm font-semibold">Ana Google Form bağlantısı<input type="url" className={`${input} mt-1`} value={links.formUrl||''} onChange={e=>setLinks({...links,formUrl:e.target.value})}/></label>
        <label className="block text-sm font-semibold">GM Özel Kod listesi bağlantısı (Google Sheets)<input type="url" className={`${input} mt-1`} value={links.codeListUrl||''} onChange={e=>setLinks({...links,codeListUrl:e.target.value})}/></label>
        <button type="button" className={`${btn} w-full bg-indigo-600 text-white`} disabled={busy||!links.formUrl||!links.codeListUrl} onClick={()=>perform('admin_leader_links',links)}>Bağlantıları Kaydet</button>
        <p className="text-xs text-slate-500">Bağlantılar lider panelinde görünür. Google Apps Script kurulumu bu bağlantılardan bağımsız, ayrıca yapılmalıdır. Kod listesini herkese açık paylaşmayın.</p>
      </div>
    </div>
    <section className="bg-white rounded-2xl p-5 border space-y-3"><h3 className="font-black text-lg">Kayıtlı Liderler</h3>
      {leaders.map(leader=><div key={leader.username} className="p-3 border rounded-xl flex flex-wrap gap-3 items-center justify-between">
        <div><p className="font-bold">{leader.name}</p><p className="text-xs text-slate-500">{leader.username} · {leader.active?'Aktif':'Pasif'}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={`${btn} bg-slate-100`} onClick={()=>{setPasswordUser(passwordUser===leader.username?'':leader.username);setNewPassword('');}}>Şifre Değiştir</button>
          <button type="button" disabled={busy} className={`${btn} ${leader.active?'bg-red-100 text-red-700':'bg-green-100 text-green-700'}`} onClick={()=>perform('admin_leader_status',{username:leader.username,active:!leader.active},'Liderin panel erişimini değiştirmek istiyor musunuz?')}>{leader.active?'Pasifleştir':'Aktifleştir'}</button>
        </div>
        {passwordUser===leader.username && <div className="w-full flex flex-wrap items-end gap-2 p-2 bg-slate-50 rounded-xl">
          <label className="flex-1 text-sm font-medium">Yeni şifre (12+ karakter)<input type="password" autoComplete="new-password" minLength={12} maxLength={128} className={input} value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
          <button className={`${btn} bg-blue-600 text-white`} type="button" disabled={busy||newPassword.length<12} onClick={async()=>{
            if(!window.confirm('Liderin eski oturumları geçersiz olacak. Şifre değişsin mi?'))return;
            await perform('admin_leader_password',{username:leader.username,password:newPassword});
            setPasswordUser('');setNewPassword('');
          }}>Yeni Şifreyi Kaydet</button>
        </div>}
      </div>)}
      {!leaders.length&&<p className="text-slate-500">Henüz lider eklenmedi.</p>}
    </section>
    <section className="bg-white rounded-2xl p-5 border"><h3 className="font-black text-lg mb-2">Lider İşlem Geçmişi</h3>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-2">Tarih</th><th className="p-2">Lider</th><th className="p-2">Öğrenci</th><th className="p-2">İşlem</th><th className="p-2">Gerekçe</th></tr></thead><tbody>
        {history.map(row=><tr key={row.id} className="border-b"><td className="p-2">{dateTime(row.at)}</td><td className="p-2">{row.leaderName} ({row.leaderId})</td><td className="p-2">{row.studentName} · {row.studentCode}</td><td className="p-2">{({leader_check:'Kontrol edildi',leader_restrict:'Kısıt uygulandı',leader_unrestrict:'Kısıt kaldırıldı',leader_device_approve:'Cihaz değişikliği onaylandı',leader_device_reject:'Cihaz değişikliği reddedildi'})[row.action]||row.action}</td><td className="p-2">{row.reason||'—'}</td></tr>)}
      </tbody></table></div><p className="text-xs text-slate-500 mt-2">Son 250 işlem görüntülenir; eski kayıtlar otomatik silinmez.</p>
    </section>
  </div>;
}
