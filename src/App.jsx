import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

const MAX_SLOTS = 10; 
const ADMIN_PIN = 'POLINES123'; 

// =====================================================================
// FUNGSI BANTUAN: MENGGABUNGKAN LOG PARKIR DENGAN NAMA MEMBER
// =====================================================================
const enrichLogsWithMembers = async (logsData) => {
  return await Promise.all(logsData.map(async (log) => {
    if (log.manual_name) {
      return { ...log, members: { name: log.manual_name }, is_manual: true };
    }
    const matchCol = log.uhf_scanned ? 'uhf_scanned' : 'rfid_scanned';
    const matchVal = log[matchCol];
    let memName = 'Tidak Terdaftar';
    
    if (matchVal) {
      const { data } = await supabase.from('members').select('name').eq(matchCol, matchVal).single();
      if (data) memName = data.name;
    }
    return { ...log, members: { name: memName }, is_manual: false };
  }));
};

// =====================================================================
// 1. WEB ADMIN (LAYOUT SIDEBAR KIRI)
// =====================================================================
function AdminWeb() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard'); 
  
  const [logs, setLogs] = useState([]);
  const [membersList, setMembersList] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, msg: '', isSuccess: true });
  
  const [formData, setFormData] = useState({ id: null, rfid_scanned: '', uhf_scanned: '', plate_scanned: '', name: '', telegram_chat_id: '' });
  const [manualData, setManualData] = useState({ name: '', purpose: '' });
  const [editMode, setEditMode] = useState(false);

  const availableSlots = Math.max(0, MAX_SLOTS - logs.length);

  const handleLogin = (e) => {
    e.preventDefault();
    if (pinInput === ADMIN_PIN) {
      setIsAuthenticated(true);
      autoDeleteOldLogs(); 
    } else {
      window.alert('PIN Salah! Akses ditolak.');
      setPinInput('');
    }
  };

  const autoDeleteOldLogs = async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('parking_logs').delete().eq('status', 'OUT').lt('time_in', twentyFourHoursAgo); 
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchInitialLogs();
    fetchMembers();
    fetchHistory();

    const channel = supabase.channel('admin-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'parking_logs' }, async (payload) => {
        if (payload.new.status === 'IN') {
            const enrichedArray = await enrichLogsWithMembers([payload.new]);
            setLogs(prevLogs => [enrichedArray[0], ...prevLogs]);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parking_logs' }, async (payload) => {
        fetchHistory(); 
        if (payload.new.status === 'OUT') {
           setLogs(prevLogs => prevLogs.filter(log => log.id !== payload.new.id));
        } else {
           const enrichedArray = await enrichLogsWithMembers([payload.new]);
           setLogs(prevLogs => prevLogs.map(log => log.id === payload.new.id ? enrichedArray[0] : log));
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pending_rfid' }, (payload) => {
        setActiveTab('dashboard');
        const detectedId = payload.new.uhf_scanned || payload.new.rfid_scanned;
        setFormData(prev => ({ 
          ...prev, 
          uhf_scanned: payload.new.uhf_scanned || prev.uhf_scanned,
          rfid_scanned: payload.new.rfid_scanned || prev.rfid_scanned
        }));
        showAlert(`📡 TAG BARU TERDETEKSI: ${detectedId}. Silakan isi form pendaftaran!`, true);
        supabase.from('pending_rfid').delete().eq('id', payload.new.id).then();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [isAuthenticated]);

  const fetchInitialLogs = async () => {
    setLoading(true);
    const { data } = await supabase.from('parking_logs').select('*').eq('status', 'IN').order('time_in', { ascending: false }); 
    if (data) setLogs(await enrichLogsWithMembers(data));
    setLoading(false);
  };

  const fetchMembers = async () => {
    const { data } = await supabase.from('members').select('*').order('created_at', { ascending: false });
    if (data) setMembersList(data);
  };

  const fetchHistory = async () => {
    const { data } = await supabase.from('parking_logs').select('*').eq('status', 'OUT').order('time_in', { ascending: false }).limit(100);
    if (data) setHistoryLogs(await enrichLogsWithMembers(data));
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: name === 'plate_scanned' ? value.toUpperCase() : value }));
  };

  const handleManualChange = (e) => {
    const { name, value } = e.target;
    setManualData(prev => ({ ...prev, [name]: value }));
  };

  const showAlert = (msg, isSuccess) => {
    setAlert({ show: true, msg, isSuccess });
    setTimeout(() => setAlert({ show: false, msg: '', isSuccess: true }), 5000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const submitData = {
      rfid_scanned: formData.rfid_scanned.trim() === '' ? null : formData.rfid_scanned,
      uhf_scanned: formData.uhf_scanned.trim() === '' ? null : formData.uhf_scanned,
      plate_scanned: formData.plate_scanned,
      name: formData.name,
      telegram_chat_id: formData.telegram_chat_id.trim() === '' ? null : formData.telegram_chat_id
    };

    if (editMode && formData.id) {
      const { error } = await supabase.from('members').update(submitData).eq('id', formData.id);
      if (error) showAlert('Gagal memperbarui data.', false);
      else {
        showAlert('Data member diperbarui!', true);
        setEditMode(false);
        setFormData({ id: null, rfid_scanned: '', uhf_scanned: '', plate_scanned: '', name: '', telegram_chat_id: '' });
        fetchMembers(); 
      }
    } else {
      const { error } = await supabase.from('members').insert([submitData]);
      if (error) showAlert('Gagal mendaftar. RFID/UHF mungkin sudah ada.', false);
      else {
        showAlert('Berhasil mendaftarkan akses!', true);
        setFormData({ id: null, rfid_scanned: '', uhf_scanned: '', plate_scanned: '', name: '', telegram_chat_id: '' });
        fetchMembers();
      }
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (availableSlots <= 0) { showAlert('Slot parkir sudah penuh!', false); return; }
    const { error } = await supabase.from('parking_logs').insert([{
      status: 'IN', time_in: new Date().toISOString(), manual_name: manualData.name, purpose: manualData.purpose
    }]);

    if (error) showAlert('Gagal menginput tamu manual.', false);
    else {
      showAlert('Tamu manual berhasil dimasukkan!', true);
      setManualData({ name: '', purpose: '' });
    }
  };

  const handleCheckout = async (id) => {
    if(window.confirm('Keluarkan kendaraan ini dari area parkir?')) {
      const { error } = await supabase.from('parking_logs').update({ status: 'OUT', time_out: new Date().toISOString() }).eq('id', id);
      if (error) showAlert('Gagal mengeluarkan kendaraan.', false);
      else showAlert('Kendaraan sukses dikeluarkan.', true);
    }
  };

  const editMember = (member) => {
    setFormData({ 
      id: member.id, rfid_scanned: member.rfid_scanned || '', uhf_scanned: member.uhf_scanned || '',
      plate_scanned: member.plate_scanned || '', name: member.name || '', telegram_chat_id: member.telegram_chat_id || '' 
    });
    setEditMode(true); setActiveTab('dashboard');
  };

  const deleteMember = async (id) => {
    if(window.confirm('Yakin ingin menghapus member ini dari database?')) {
      await supabase.from('members').delete().eq('id', id);
      showAlert('Member berhasil dihapus.', true); fetchMembers();
    }
  };

  // ----------------------------------------------------
  // TAMPILAN LOGIN ADMIN
  // ----------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-black min-h-screen flex items-center justify-center text-white font-sans relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-600/20 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-600/20 rounded-full blur-[100px]"></div>
        
        <div className="glass-panel p-10 rounded-3xl w-full max-w-sm shadow-[0_8px_32px_rgba(0,0,0,0.5)] animate-pop-in relative z-10">
          <div className="flex justify-center mb-4"><span className="text-5xl">🔐</span></div>
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 mb-6 text-center">Kunci Keamanan</h2>
          <form onSubmit={handleLogin} className="space-y-6">
            <input type="password" required autoFocus value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="••••••••" className="w-full bg-slate-900/50 border border-slate-600/50 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 rounded-xl p-4 text-white text-center tracking-[0.5em] text-2xl outline-none transition-all" />
            <button type="submit" className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 active:scale-95 py-3.5 rounded-xl font-bold transition-all shadow-lg shadow-blue-500/30 text-white">Buka Kunci</button>
          </form>
          <button onClick={() => window.location.hash = ''} className="w-full text-slate-400 text-sm mt-6 hover:text-white transition-colors">← Kembali ke Beranda</button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // TAMPILAN DASHBOARD ADMIN (DENGAN SIDEBAR KIRI)
  // ----------------------------------------------------
  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-black text-slate-100 font-sans h-screen flex overflow-hidden animate-fade-in">
      
      {/* 📌 SIDEBAR KIRI */}
      <aside className="w-72 glass-panel border-r border-slate-700/50 flex flex-col relative z-20 shadow-2xl flex-shrink-0">
        <div className="p-6 border-b border-slate-700/50 text-center">
          <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 tracking-wide mt-2">SCADA PARKIR</h1>
          <p className="text-xs text-slate-400 mt-2 font-medium bg-slate-800/50 inline-block px-3 py-1 rounded-full border border-slate-700">Lab Kendali - Polines</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold transition-all duration-300 text-left ${activeTab === 'dashboard' ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/20 translate-x-1' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 hover:translate-x-1'}`}>
            <span className="text-xl">📡</span> Monitor & Form
          </button>
          
          <button onClick={() => setActiveTab('manual')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold transition-all duration-300 text-left ${activeTab === 'manual' ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-lg shadow-purple-500/20 translate-x-1' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 hover:translate-x-1'}`}>
            <span className="text-xl">📝</span> Tamu & Manual
          </button>
          
          <button onClick={() => setActiveTab('members')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold transition-all duration-300 text-left ${activeTab === 'members' ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/20 translate-x-1' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 hover:translate-x-1'}`}>
            <span className="text-xl">👥</span> Manajemen Member
          </button>
          
          <button onClick={() => setActiveTab('history')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold transition-all duration-300 text-left ${activeTab === 'history' ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/20 translate-x-1' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 hover:translate-x-1'}`}>
            <span className="text-xl">🕒</span> Histori 24 Jam
          </button>
        </nav>

        <div className="p-4 border-t border-slate-700/50">
          <button onClick={() => { setIsAuthenticated(false); window.location.hash = ''; }} className="w-full flex items-center justify-center gap-2 bg-red-900/20 text-red-400 border border-red-800/50 hover:bg-red-600 hover:text-white px-4 py-3.5 rounded-xl transition-all active:scale-95 font-semibold">
            <span>🚪</span> Log Out
          </button>
        </div>
      </aside>

      {/* 📌 KONTEN UTAMA (KANAN) */}
      <main className="flex-1 flex flex-col h-screen relative overflow-hidden bg-gradient-to-br from-slate-900/50 to-black">
        
        {/* Header Atas (Top Bar) */}
        <header className="p-6 flex justify-between items-center border-b border-slate-800/50 glass-panel">
          <div className="flex items-center gap-3">
             <span className="text-slate-400 font-medium">Status Sistem:</span>
             <span className="flex items-center gap-2 bg-green-900/30 text-green-400 border border-green-800/50 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider animate-pulse">
               <span className="w-2 h-2 rounded-full bg-green-400"></span> Online
             </span>
          </div>
          
          <div className="flex gap-4 items-center">
            {alert.show && (
              <div className={`px-4 py-2 rounded-xl shadow-2xl border flex items-center gap-2 animate-slide-down ${alert.isSuccess ? 'bg-green-900/90 border-green-500/50 text-green-100' : 'bg-red-900/90 border-red-500/50 text-red-100'}`}>
                <span className="text-lg">{alert.isSuccess ? '✅' : '⚠️'}</span>
                <span className="font-medium text-sm">{alert.msg}</span>
              </div>
            )}
            
            <div className="bg-slate-800/80 border border-slate-700/50 px-5 py-2 rounded-xl text-center shadow-inner flex items-center gap-4">
              <span className="text-xs text-slate-400 uppercase font-semibold tracking-wider">Sisa Slot Area</span>
              <span className={`text-2xl font-black ${availableSlots === 0 ? 'text-red-500 animate-pulse' : 'text-green-400'}`}>
                {availableSlots} <span className="text-slate-600 text-lg font-medium">/ {MAX_SLOTS}</span>
              </span>
            </div>
          </div>
        </header>

        {/* Area Konten Dinamis yang bisa di-scroll */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          
          {/* TAB: DASHBOARD (Monitor & Form) */}
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
              {/* Form Pendaftaran */}
              <div className="glass-panel rounded-2xl p-6 lg:col-span-1 h-fit shadow-xl border border-slate-700/50">
                <h2 className="text-lg font-bold mb-6 text-white border-b border-slate-700 pb-3 flex items-center gap-2">
                  {editMode ? <span className="text-yellow-400">✏️ Edit Data Akses</span> : "➕ Pendaftaran Akses"}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-xs font-semibold text-slate-400 mb-1.5">UID UHF</label><input type="text" name="uhf_scanned" value={formData.uhf_scanned} onChange={handleInputChange} className="w-full bg-slate-900/50 border border-slate-600/50 rounded-lg p-2.5 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none transition-all text-sm font-mono text-blue-300" /></div>
                    <div><label className="block text-xs font-semibold text-slate-400 mb-1.5">UID RFID</label><input type="text" name="rfid_scanned" value={formData.rfid_scanned} onChange={handleInputChange} className="w-full bg-slate-900/50 border border-slate-600/50 rounded-lg p-2.5 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none transition-all text-sm font-mono text-cyan-300" /></div>
                  </div>
                  <div><label className="block text-xs font-semibold text-slate-400 mb-1.5">Plat Nomor Kendaraan</label><input type="text" name="plate_scanned" required value={formData.plate_scanned} onChange={handleInputChange} className="w-full bg-slate-900/50 border border-slate-600/50 rounded-lg p-3 uppercase focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none transition-all font-mono font-bold tracking-widest text-lg" /></div>
                  <div><label className="block text-xs font-semibold text-slate-400 mb-1.5">Nama Lengkap</label><input type="text" name="name" required value={formData.name} onChange={handleInputChange} className="w-full bg-slate-900/50 border border-slate-600/50 rounded-lg p-3 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none transition-all" /></div>
                  <div><label className="block text-xs font-semibold text-slate-400 mb-1.5">ID Telegram <span className="font-normal opacity-50">(Opsional)</span></label><input type="text" name="telegram_chat_id" value={formData.telegram_chat_id} onChange={handleInputChange} className="w-full bg-slate-900/50 border border-slate-600/50 rounded-lg p-3 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none transition-all font-mono text-sm" /></div>
                  <div className="flex gap-3 pt-2">
                    <button type="submit" className={`flex-1 py-3 rounded-lg font-bold transition-all active:scale-95 shadow-lg ${editMode ? 'bg-gradient-to-r from-yellow-600 to-orange-500 shadow-yellow-600/20' : 'bg-gradient-to-r from-blue-600 to-cyan-500 shadow-blue-500/20'} text-white`}>{editMode ? 'Update Data' : 'Simpan Data'}</button>
                    {editMode && <button type="button" onClick={() => setEditMode(false)} className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-5 rounded-lg transition-all active:scale-95">Batal</button>}
                  </div>
                </form>
              </div>
              
              {/* Tabel Live Monitor */}
              <div className="glass-panel rounded-2xl p-6 lg:col-span-2 shadow-xl border border-slate-700/50 flex flex-col h-full">
                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-3 mb-4 flex items-center gap-2">🚗 Kendaraan di Dalam Area (Live)</h2>
                <div className="overflow-auto rounded-lg border border-slate-700/50 flex-1 custom-scrollbar">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="sticky top-0 bg-slate-800/90 backdrop-blur-md z-10 shadow-sm">
                      <tr className="text-slate-300 uppercase tracking-wider text-xs font-semibold">
                        <th className="p-4">Waktu Masuk</th><th className="p-4">Tag / Keperluan</th><th className="p-4">Pemilik</th><th className="p-4 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {loading ? (
                         <tr><td colSpan="4" className="p-12 text-center text-slate-400 animate-pulse">Memuat data langsung dari server...</td></tr>
                      ) : logs.length === 0 ? (
                         <tr><td colSpan="4" className="p-12 text-center text-slate-400">Area parkir saat ini kosong.</td></tr>
                      ) : logs.map(log => (
                        <tr key={log.id} className="hover:bg-slate-800/50 transition-colors group">
                          <td className="p-4 text-slate-300 font-mono text-xs">{new Date(log.time_in).toLocaleTimeString('id-ID', { hour12: false })}</td>
                          <td className="p-4 font-mono text-xs">{log.is_manual ? <span className="text-purple-300 bg-purple-900/40 px-2 py-1 rounded-md border border-purple-500/30">📝 {log.purpose}</span> : <span className="text-yellow-400 font-bold tracking-wider">{log.uhf_scanned || log.rfid_scanned}</span>}</td>
                          <td className="p-4 text-white font-medium flex items-center gap-2">
                             {log.members?.name} {log.is_manual && <span className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300 font-semibold uppercase">Tamu</span>}
                          </td>
                          <td className="p-4 text-center">
                            <button onClick={() => handleCheckout(log.id)} className="bg-red-900/30 text-red-400 border border-red-800/50 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded-lg transition-all active:scale-95 text-xs font-bold opacity-50 group-hover:opacity-100">Checkout</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: MANUAL / TAMU */}
          {activeTab === 'manual' && (
            <div className="max-w-2xl mx-auto animate-pop-in mt-4">
              <div className="glass-panel rounded-3xl p-10 border border-slate-700/50 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/10 rounded-full blur-[80px] -z-10"></div>
                
                <div className="flex items-center gap-4 mb-8 border-b border-slate-700 pb-5">
                  <div className="bg-gradient-to-br from-purple-500 to-pink-500 p-4 rounded-2xl shadow-lg shadow-purple-500/30">
                    <span className="text-2xl text-white">📝</span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-white tracking-wide">Input Kendaraan Manual</h2>
                    <p className="text-sm text-slate-400 mt-1">Catat tamu atau kendaraan darurat tanpa kartu akses.</p>
                  </div>
                </div>
                
                <form onSubmit={handleManualSubmit} className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-300 mb-2">Nama Tamu / Pengendara</label>
                    <input type="text" name="name" required value={manualData.name} onChange={handleManualChange} placeholder="Contoh: Budi Santoso..." className="w-full bg-slate-900/60 border border-slate-600/50 rounded-xl p-4 text-white focus:border-purple-400 focus:ring-2 focus:ring-purple-400/30 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-300 mb-2">Keperluan / Keterangan</label>
                    <textarea name="purpose" required value={manualData.purpose} onChange={handleManualChange} placeholder="Kurir paket, Tamu VIP Mobil Plat H 1 XYZ..." rows="3" className="w-full bg-slate-900/60 border border-slate-600/50 rounded-xl p-4 text-white focus:border-purple-400 focus:ring-2 focus:ring-purple-400/30 outline-none resize-none transition-all"></textarea>
                  </div>
                  <button type="submit" disabled={availableSlots <= 0} className={`w-full font-black text-lg py-4 rounded-xl transition-all active:scale-95 shadow-xl ${availableSlots > 0 ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-purple-500/30' : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'}`}>
                    {availableSlots > 0 ? 'Buka Gerbang & Masukkan Ke Area' : '⚠️ Area Parkir Penuh'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB: MEMBER */}
          {activeTab === 'members' && (
            <div className="glass-panel rounded-2xl p-6 border border-slate-700/50 shadow-xl animate-fade-in flex flex-col h-[calc(100vh-160px)]">
              <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-3 mb-4">👥 Daftar Member & Akses Terdaftar</h2>
              <div className="overflow-auto rounded-lg border border-slate-700/50 flex-1 custom-scrollbar">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="sticky top-0 bg-slate-800/90 backdrop-blur-md z-10 shadow-sm"><tr className="text-slate-300 uppercase text-xs font-semibold"><th className="p-4">UID UHF (Kaca)</th><th className="p-4">UID RFID (Kartu)</th><th className="p-4">Plat Nomor</th><th className="p-4">Nama Lengkap</th><th className="p-4 text-center">Aksi</th></tr></thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {membersList.map(m => (
                      <tr key={m.id} className="hover:bg-slate-800/50 transition-colors group">
                        <td className="p-4 text-blue-400 font-mono text-xs">{m.uhf_scanned || '-'}</td>
                        <td className="p-4 text-cyan-400 font-mono text-xs">{m.rfid_scanned || '-'}</td>
                        <td className="p-4 text-slate-200 font-mono font-bold tracking-widest text-base">{m.plate_scanned}</td>
                        <td className="p-4 font-medium text-white">{m.name}</td>
                        <td className="p-4 text-center flex justify-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => editMember(m)} className="bg-blue-900/40 text-blue-300 hover:bg-blue-600 hover:text-white px-3 py-1.5 rounded border border-blue-800/50 transition-colors text-xs font-bold">Edit</button>
                          <button onClick={() => deleteMember(m.id)} className="bg-red-900/40 text-red-300 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded border border-red-800/50 transition-colors text-xs font-bold">Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: HISTORY */}
          {activeTab === 'history' && (
            <div className="glass-panel rounded-2xl p-6 border border-slate-700/50 shadow-xl animate-fade-in flex flex-col h-[calc(100vh-160px)]">
              <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-3 mb-4">🕒 Riwayat Kendaraan Keluar (24 Jam Terakhir)</h2>
              <div className="overflow-auto rounded-lg border border-slate-700/50 flex-1 custom-scrollbar">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="sticky top-0 bg-slate-800/90 backdrop-blur-md z-10 shadow-sm"><tr className="text-slate-300 uppercase text-xs font-semibold"><th className="p-4">Waktu Masuk</th><th className="p-4">Waktu Keluar</th><th className="p-4">Tag / Status</th><th className="p-4">Pemilik & Keterangan</th></tr></thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {historyLogs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-4 text-slate-300 font-mono text-xs">{new Date(log.time_in).toLocaleString('id-ID')}</td>
                        <td className="p-4 text-slate-400 font-mono text-xs">{log.time_out ? new Date(log.time_out).toLocaleString('id-ID') : '-'}</td>
                        <td className="p-4 font-mono text-xs">{log.is_manual ? <span className="text-purple-300 bg-purple-900/40 px-2 py-1 rounded border border-purple-500/30">📝 Tamu Manual</span> : <span className="text-yellow-400 font-bold">{log.uhf_scanned || log.rfid_scanned}</span>}</td>
                        <td className="p-4 text-white font-medium">{log.members?.name} {log.is_manual && <span className="block text-[11px] text-slate-400 mt-1 opacity-80">{log.purpose}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// =====================================================================
// 2. WEB PENGGUNA (VMS GERBANG) - [SAMA SEPERTI SEBELUMNYA]
// =====================================================================
function PublicWeb() {
  const [logs, setLogs] = useState([]);
  const [notify, setNotify] = useState({ show: false, type: '', name: '', plate_scanned: '' });
  const timerRef = useRef(null);
  const availableSlots = Math.max(0, MAX_SLOTS - logs.length);
  const isFull = availableSlots === 0;

  useEffect(() => {
    const fetchSlotsAndData = async () => {
      const { data } = await supabase.from('parking_logs').select('*').eq('status', 'IN').order('time_in', { ascending: false });
      if (data) setLogs(await enrichLogsWithMembers(data));
    };
    fetchSlotsAndData();

    const channel = supabase.channel('public-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'parking_logs' }, async (payload) => {
        if (payload.new.status === 'IN') {
          const matchCol = payload.new.uhf_scanned ? 'uhf_scanned' : 'rfid_scanned';
          const matchVal = payload.new[matchCol];
          const enrichedArray = await enrichLogsWithMembers([payload.new]);
          setLogs(prev => [enrichedArray[0], ...prev]); 
          if (!payload.new.manual_name) triggerNotification(matchVal, matchCol, 'IN'); 
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parking_logs' }, async (payload) => {
        if (payload.new.status === 'OUT') {
          setLogs(prev => prev.filter(log => log.id !== payload.new.id)); 
          const matchCol = payload.new.uhf_scanned ? 'uhf_scanned' : 'rfid_scanned';
          if (!payload.new.manual_name) triggerNotification(payload.new[matchCol], matchCol, 'OUT'); 
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const triggerNotification = async (scannedId, columnType, type) => {
    let notifyName = 'Tamu Tak Dikenal'; let notifyPlate = '---';
    if (scannedId) {
      const { data } = await supabase.from('members').select('name, plate_scanned').eq(columnType, scannedId).single();
      if (data) { notifyName = data.name; notifyPlate = data.plate_scanned; }
    }
    setNotify({ show: true, type: type, name: notifyName, plate_scanned: notifyPlate });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setNotify({ show: false, type: '', name: '', plate_scanned: '' }); }, 7000);
  };

  return (
    <div className="bg-black text-white font-sans h-screen flex flex-col relative overflow-hidden">
      <div className={`absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] transition-colors duration-1000 ${isFull ? 'from-red-950/20 via-black to-black' : 'from-blue-950/20 via-black to-black'}`}></div>

      <button onClick={() => window.location.hash = ''} className="absolute top-6 left-6 text-sm text-slate-600 hover:text-white transition-colors z-50 font-bold tracking-wider">← KELUAR</button>
      
      <div className={`absolute inset-0 flex flex-col transition-all duration-[800ms] p-8 ${notify.show ? 'opacity-0 scale-95 blur-sm' : 'opacity-100 scale-100 blur-0'} z-0`}>
        <h1 className="text-3xl md:text-5xl font-black tracking-[0.2em] mb-10 text-center mt-6 text-transparent bg-clip-text bg-gradient-to-r from-slate-200 to-slate-500 drop-shadow-2xl">
          PARKING SYSTEM <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-400">POLINES</span>
        </h1>
        
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-10 max-w-7xl mx-auto w-full pb-10">
          <div className={`relative border-2 rounded-[40px] p-12 flex flex-col justify-center items-center text-center transition-all duration-700 shadow-2xl backdrop-blur-sm overflow-hidden ${isFull ? 'border-red-600/50 bg-red-950/20 shadow-red-900/20' : 'border-blue-500/30 bg-blue-950/10 shadow-blue-900/20'}`}>
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full blur-[100px] opacity-40 transition-colors duration-700 ${isFull ? 'bg-red-600' : 'bg-green-500'}`}></div>
            
            <h2 className="text-3xl font-bold tracking-widest text-slate-400 mb-8 uppercase relative z-10">Sisa Slot Parkir</h2>
            {isFull ? (
              <span className="text-7xl md:text-9xl font-black text-red-500 animate-pulse tracking-tight drop-shadow-[0_0_30px_rgba(239,68,68,0.8)] relative z-10">PENUH</span>
            ) : (
              <div className="relative z-10 flex items-baseline">
                <span className="text-[9rem] md:text-[14rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-green-300 to-green-600 drop-shadow-[0_0_40px_rgba(34,197,94,0.4)]">{availableSlots}</span>
                <span className="text-6xl text-slate-600 font-medium ml-4">/ {MAX_SLOTS}</span>
              </div>
            )}
          </div>
          
          <div className="glass-panel border border-slate-800 rounded-[40px] p-8 flex flex-col h-full overflow-hidden shadow-2xl relative">
            <h2 className="text-2xl font-bold text-slate-300 mb-6 border-b border-slate-800 pb-5 text-center tracking-widest uppercase">Kendaraan Terparkir</h2>
            <div className="overflow-y-auto flex-1 pr-4 custom-scrollbar">
              <table className="w-full text-left text-xl">
                <thead><tr className="text-slate-500 border-b border-slate-800/50"><th className="pb-4 font-semibold tracking-wider text-sm uppercase">Jam Masuk</th><th className="pb-4 font-semibold tracking-wider text-sm uppercase">Pemilik</th></tr></thead>
                <tbody className="divide-y divide-slate-800/50">
                  {logs.length === 0 ? (
                    <tr><td colSpan="2" className="py-12 text-center text-slate-600 text-lg">Area parkir kosong</td></tr>
                  ) : logs.map((log) => (
                    <tr key={log.id} className="animate-fade-in group hover:bg-slate-800/30 transition-colors">
                      <td className="py-5 font-mono text-slate-400 text-lg group-hover:text-slate-300 transition-colors">{new Date(log.time_in).toLocaleTimeString('id-ID', { hour12: false })}</td>
                      <td className="py-5 font-bold text-slate-200 text-xl group-hover:text-white transition-colors">{log.members?.name} {log.is_manual && <span className="ml-2 text-sm text-slate-500 font-normal italic">(Tamu)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className={`absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-xl transition-all duration-500 ${notify.show ? 'opacity-100 z-50' : 'opacity-0 -z-10'}`}>
        <div className={`relative border border-slate-700/50 rounded-[50px] p-16 md:p-24 text-center w-11/12 max-w-6xl overflow-hidden ${notify.show ? 'animate-pop-in' : 'scale-90 opacity-0'} ${notify.type === 'IN' ? 'bg-blue-950/40 shadow-[0_0_150px_rgba(59,130,246,0.3)]' : 'bg-green-950/40 shadow-[0_0_150px_rgba(34,197,94,0.3)]'}`}>
          <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] rounded-full blur-[120px] -z-10 ${notify.type === 'IN' ? 'bg-blue-600/30' : 'bg-green-600/30'}`}></div>

          <h2 className={`text-6xl md:text-8xl font-black mb-8 tracking-tighter ${notify.type === 'IN' ? 'text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-cyan-300' : 'text-transparent bg-clip-text bg-gradient-to-r from-green-300 to-emerald-400'}`}>
            {notify.type === 'IN' ? 'SELAMAT DATANG' : 'TERIMA KASIH'}
          </h2>
          <p className="text-4xl md:text-6xl font-bold text-white mb-12 drop-shadow-lg">{notify.name}</p>
          
          <div className={`border-2 rounded-3xl py-8 md:py-10 mx-auto px-16 md:px-24 mb-10 w-fit backdrop-blur-md shadow-2xl ${notify.type === 'IN' ? 'border-blue-500/30 bg-blue-900/20' : 'border-green-500/30 bg-green-900/20'}`}>
            <p className="text-7xl md:text-9xl font-mono font-black text-yellow-400 tracking-[0.15em] drop-shadow-[0_0_20px_rgba(250,204,21,0.5)]">{notify.plate_scanned}</p>
          </div>
          
          <p className="text-2xl md:text-3xl text-slate-400 font-medium">
            {notify.type === 'IN' ? 'Silakan masuk, palang terbuka otomatis.' : 'Hati-hati di jalan, sampai jumpa kembali!'}
          </p>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 3. ROUTER UTAMA & INJEKSI CSS CUSTOM
// =====================================================================
export default function App() {
  const [currentView, setCurrentView] = useState('');
  
  useEffect(() => {
    const handleHash = () => setCurrentView(window.location.hash);
    handleHash(); 
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  return (
    <>
      {/* INJEKSI CUSTOM CSS UNTUK ANIMASI & STYLING TAMBAHAN */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes popIn { 0% { transform: scale(0.95); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-fade-in { animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-pop-in { animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        .animate-slide-down { animation: slideDown 0.4s ease-out forwards; }
        .glass-panel { background: rgba(30, 41, 59, 0.4); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
        .custom-scrollbar::-webkit-scrollbar { height: 6px; width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }
      `}</style>

      {currentView === '#admin' ? <AdminWeb /> : currentView === '#public' ? <PublicWeb /> : (
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-black min-h-screen flex flex-col items-center justify-center font-sans text-white p-6 relative overflow-hidden">
          <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] animate-pulse"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-green-600/10 rounded-full blur-[120px] animate-pulse"></div>

          <div className="relative z-10 animate-fade-in text-center max-w-4xl w-full">
            <div className="inline-block bg-slate-800/50 border border-slate-700 backdrop-blur-sm px-6 py-2 rounded-full mb-8">
              <span className="text-sm font-bold tracking-widest text-slate-300 uppercase">System Control Panel</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-orange-400 to-yellow-500 drop-shadow-xl">
              SCADA PARKIR IOT
            </h1>
            <p className="text-slate-400 mb-16 text-lg md:text-xl font-medium">Silakan pilih antarmuka sistem untuk melanjutkan operasional.</p>
            
            <div className="flex flex-col md:flex-row gap-8 justify-center w-full">
              <button onClick={() => window.location.hash = 'admin'} className="group relative glass-panel border border-slate-700 hover:border-blue-500/50 p-10 rounded-3xl w-full md:w-1/2 text-left overflow-hidden transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(59,130,246,0.2)]">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="bg-blue-900/40 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 border border-blue-500/30 group-hover:scale-110 transition-transform duration-500">
                  <span className="text-3xl">🛡️</span>
                </div>
                <h2 className="text-3xl font-bold text-blue-400 mb-3 group-hover:text-blue-300 transition-colors">Web Admin SCADA</h2>
                <p className="text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">Akses dasbor kontrol gerbang, manajemen pendaftaran member, input tamu manual, dan histori riwayat parkir.</p>
              </button>

              <button onClick={() => window.location.hash = 'public'} className="group relative glass-panel border border-slate-700 hover:border-green-500/50 p-10 rounded-3xl w-full md:w-1/2 text-left overflow-hidden transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(34,197,94,0.2)]">
                <div className="absolute inset-0 bg-gradient-to-br from-green-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="bg-green-900/40 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 border border-green-500/30 group-hover:scale-110 transition-transform duration-500">
                  <span className="text-3xl">🖥️</span>
                </div>
                <h2 className="text-3xl font-bold text-green-400 mb-3 group-hover:text-green-300 transition-colors">Web Layar VMS</h2>
                <p className="text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">Tampilan layar besar (publik) di area gerbang masuk. Menampilkan data live, slot parkir, dan notifikasi penyambutan.</p>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}