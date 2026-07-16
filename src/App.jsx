import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

const MAX_SLOTS = 10; 
const ADMIN_PIN = 'POLINES123'; 

// =====================================================================
// FUNGSI BANTUAN: MENGGABUNGKAN LOG PARKIR DENGAN NAMA MEMBER
// =====================================================================
const enrichLogsWithMembers = async (logsData) => {
  return await Promise.all(logsData.map(async (log) => {
    // Jika log tamu manual
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
// 1. WEB ADMIN
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
        showAlert(`📡 TAG BARU TERDETEKSI: ${detectedId}. Silakan isi data!`, true);
        supabase.from('pending_rfid').delete().eq('id', payload.new.id).then();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [isAuthenticated]);

  const fetchInitialLogs = async () => {
    setLoading(true);
    const { data } = await supabase.from('parking_logs').select('*').eq('status', 'IN').order('time_in', { ascending: false }); 
    if (data) {
      const enrichedData = await enrichLogsWithMembers(data);
      setLogs(enrichedData);
    }
    setLoading(false);
  };

  const fetchMembers = async () => {
    const { data } = await supabase.from('members').select('*').order('created_at', { ascending: false });
    if (data) setMembersList(data);
  };

  const fetchHistory = async () => {
    const { data } = await supabase.from('parking_logs').select('*').eq('status', 'OUT').order('time_in', { ascending: false }).limit(100);
    if (data) {
      const enrichedData = await enrichLogsWithMembers(data);
      setHistoryLogs(enrichedData);
    }
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
        showAlert('Berhasil diverifikasi!', true);
        setFormData({ id: null, rfid_scanned: '', uhf_scanned: '', plate_scanned: '', name: '', telegram_chat_id: '' });
        fetchMembers();
      }
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (availableSlots <= 0) {
      showAlert('Slot parkir sudah penuh!', false); return;
    }
    const { error } = await supabase.from('parking_logs').insert([{
      status: 'IN',
      time_in: new Date().toISOString(),
      manual_name: manualData.name,
      purpose: manualData.purpose
    }]);

    if (error) showAlert('Gagal menginput tamu manual.', false);
    else {
      showAlert('Tamu manual berhasil dimasukkan!', true);
      setManualData({ name: '', purpose: '' });
    }
  };

  const handleCheckout = async (id) => {
    if(window.confirm('Keluarkan kendaraan ini dari area parkir?')) {
      const { error } = await supabase.from('parking_logs').update({
        status: 'OUT',
        time_out: new Date().toISOString()
      }).eq('id', id);
      if (error) showAlert('Gagal mengeluarkan kendaraan.', false);
      else showAlert('Kendaraan dikeluarkan.', true);
    }
  };

  const editMember = (member) => {
    setFormData({ 
      id: member.id, rfid_scanned: member.rfid_scanned || '', uhf_scanned: member.uhf_scanned || '',
      plate_scanned: member.plate_scanned || '', name: member.name || '', telegram_chat_id: member.telegram_chat_id || '' 
    });
    setEditMode(true);
    setActiveTab('dashboard'); 
    window.scrollTo(0, 0);
  };

  const deleteMember = async (id) => {
    if(window.confirm('Yakin ingin menghapus?')) {
      await supabase.from('members').delete().eq('id', id);
      showAlert('Member dihapus.', true);
      fetchMembers();
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="bg-slate-900 min-h-screen flex items-center justify-center text-white font-sans">
        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 w-96 shadow-2xl">
          <h2 className="text-2xl font-bold text-blue-400 mb-6 text-center">🔐 Kunci Keamanan</h2>
          <form onSubmit={handleLogin}>
            <input type="password" required autoFocus value={pinInput} onChange={(e) => setPinInput(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white text-center tracking-widest text-xl mb-4" />
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold">Buka Kunci</button>
          </form>
          <button onClick={() => window.location.hash = ''} className="w-full text-slate-500 text-sm mt-4">Kembali</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 text-slate-100 font-sans min-h-screen flex flex-col">
      <header className="bg-slate-800 border-b border-slate-700 p-6 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">DASHBOARD ADMIN SCADA</h1>
            <p className="text-sm text-slate-400 mt-1">Laboratorium Kendali - Polines</p>
          </div>
          <div className="flex gap-4 items-center">
            <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-lg text-center">
              <span className="text-xs text-slate-400 block uppercase">Sisa Slot Parkir</span>
              <span className={`text-xl font-bold ${availableSlots === 0 ? 'text-red-500' : 'text-green-400'}`}>{availableSlots} / {MAX_SLOTS}</span>
            </div>
            <button onClick={() => { setIsAuthenticated(false); window.location.hash = ''; }} className="text-sm bg-red-900/50 text-red-400 border border-red-800 px-4 py-2 rounded">Log Out</button>
          </div>
        </div>
        
        <div className="max-w-7xl mx-auto flex gap-2 relative overflow-x-auto pb-1">
          <button onClick={() => setActiveTab('dashboard')} className={`px-4 py-2 whitespace-nowrap rounded-t-lg font-semibold ${activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>Monitor & Form RFID</button>
          <button onClick={() => setActiveTab('manual')} className={`px-4 py-2 whitespace-nowrap rounded-t-lg font-semibold ${activeTab === 'manual' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300'}`}>Tamu & Manual</button>
          <button onClick={() => setActiveTab('members')} className={`px-4 py-2 whitespace-nowrap rounded-t-lg font-semibold ${activeTab === 'members' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>Manajemen Member</button>
          <button onClick={() => setActiveTab('history')} className={`px-4 py-2 whitespace-nowrap rounded-t-lg font-semibold ${activeTab === 'history' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>Histori 24 Jam</button>
          {alert.show && <div className={`absolute right-0 top-0 p-3 rounded-lg shadow-xl border z-50 ${alert.isSuccess ? 'bg-green-900 border-green-500' : 'bg-red-900 border-red-500'}`}>{alert.msg}</div>}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 w-full flex-1">
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 lg:col-span-1 h-fit">
              <h2 className="text-xl font-semibold mb-4 text-white border-b border-slate-600 pb-2">{editMode ? "Edit Data" : "Pendaftaran Akses"}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-sm text-slate-300 mb-1">UID UHF</label><input type="text" name="uhf_scanned" value={formData.uhf_scanned} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 outline-none" /></div>
                  <div><label className="block text-sm text-slate-300 mb-1">UID RFID</label><input type="text" name="rfid_scanned" value={formData.rfid_scanned} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 outline-none" /></div>
                </div>
                <div><label className="block text-sm text-slate-300 mb-1">Plat Nomor</label><input type="text" name="plate_scanned" required value={formData.plate_scanned} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 uppercase outline-none" /></div>
                <div><label className="block text-sm text-slate-300 mb-1">Nama Pemilik</label><input type="text" name="name" required value={formData.name} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 outline-none" /></div>
                <div><label className="block text-sm text-slate-300 mb-1">ID Telegram (Ops)</label><input type="text" name="telegram_chat_id" value={formData.telegram_chat_id} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 outline-none" /></div>
                <div className="flex gap-2">
                  <button type="submit" className={`w-full py-2.5 rounded-lg ${editMode ? 'bg-yellow-600' : 'bg-blue-600'} text-white`}>{editMode ? 'Update' : 'Simpan'}</button>
                  {editMode && <button type="button" onClick={() => setEditMode(false)} className="bg-slate-600 text-white py-2.5 px-4 rounded-lg">Batal</button>}
                </div>
              </form>
            </div>
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 lg:col-span-2">
              <h2 className="text-xl font-semibold text-white border-b border-slate-600 pb-2 mb-4">Kendaraan di Dalam Area (Live)</h2>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 uppercase tracking-wide">
                    <th className="p-3">Masuk</th><th className="p-3">Tag / Keperluan</th><th className="p-3">Nama Pemilik</th><th className="p-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="p-3 text-slate-300 font-mono">{new Date(log.time_in).toLocaleTimeString('id-ID', { hour12: false })}</td>
                      <td className="p-3 font-mono">{log.is_manual ? <span className="text-purple-400">📝 {log.purpose}</span> : <span className="text-yellow-400">{log.uhf_scanned || log.rfid_scanned}</span>}</td>
                      <td className="p-3 text-white font-semibold">{log.members?.name} {log.is_manual && <span className="ml-2 text-[10px] bg-slate-700 px-1 rounded">Tamu</span>}</td>
                      <td className="p-3 text-center"><button onClick={() => handleCheckout(log.id)} className="bg-red-900/50 text-red-300 px-3 py-1 rounded">Keluarkan</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'manual' && (
          <div className="max-w-xl mx-auto bg-slate-800 rounded-xl p-8 border border-slate-700 shadow-xl">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">Input Kendaraan Manual (Tamu)</h2>
            <form onSubmit={handleManualSubmit} className="space-y-5">
              <div><label className="block text-sm text-slate-300 mb-1">Nama Tamu</label><input type="text" name="name" required value={manualData.name} onChange={handleManualChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 outline-none" /></div>
              <div><label className="block text-sm text-slate-300 mb-1">Keperluan</label><textarea name="purpose" required value={manualData.purpose} onChange={handleManualChange} rows="3" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 outline-none resize-none"></textarea></div>
              <button type="submit" disabled={availableSlots <= 0} className={`w-full font-bold py-3.5 rounded-lg ${availableSlots > 0 ? 'bg-purple-600' : 'bg-slate-700'}`}>{availableSlots > 0 ? 'Masukan Area' : 'Parkir Penuh'}</button>
            </form>
          </div>
        )}

        {activeTab === 'members' && (
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h2 className="text-xl font-semibold text-white border-b border-slate-600 pb-2 mb-4">Daftar Member</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="bg-slate-900 text-slate-300"><th className="p-3">UHF</th><th className="p-3">RFID</th><th className="p-3">Plat</th><th className="p-3">Nama</th><th className="p-3 text-center">Aksi</th></tr></thead>
              <tbody>
                {membersList.map(m => (
                  <tr key={m.id} className="border-t border-slate-700">
                    <td className="p-3 text-blue-400 font-mono">{m.uhf_scanned || '-'}</td><td className="p-3 text-yellow-400 font-mono">{m.rfid_scanned || '-'}</td><td className="p-3 text-slate-300">{m.plate_scanned}</td><td className="p-3">{m.name}</td>
                    <td className="p-3 text-center">
                      <button onClick={() => editMember(m)} className="bg-blue-900/50 text-blue-300 px-3 py-1 rounded mr-2">Edit</button>
                      <button onClick={() => deleteMember(m.id)} className="bg-red-900/50 text-red-300 px-3 py-1 rounded">Hapus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h2 className="text-xl font-semibold text-white border-b border-slate-600 pb-2 mb-4">Riwayat Parkir Selesai</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="bg-slate-900 text-slate-300"><th className="p-3">Masuk</th><th className="p-3">Keluar</th><th className="p-3">Tag / Status</th><th className="p-3">Nama Pemilik</th></tr></thead>
              <tbody>
                {historyLogs.map(log => (
                  <tr key={log.id} className="border-t border-slate-700">
                    <td className="p-3 font-mono">{new Date(log.time_in).toLocaleString('id-ID')}</td>
                    <td className="p-3 font-mono">{log.time_out ? new Date(log.time_out).toLocaleString('id-ID') : '-'}</td>
                    <td className="p-3">{log.is_manual ? <span className="text-purple-400">📝 Tamu Manual</span> : <span className="text-yellow-400">{log.uhf_scanned || log.rfid_scanned}</span>}</td>
                    <td className="p-3">{log.members?.name} {log.is_manual && <span className="block text-xs text-slate-400">Keperluan: {log.purpose}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 2. WEB PENGGUNA (VMS GERBANG)
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
          // Notifikasi hanya muncul jika bukan tamu manual
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
      <button onClick={() => window.location.hash = ''} className="absolute top-4 left-4 text-xs text-slate-800 z-50">Keluar</button>
      <div className={`absolute inset-0 flex flex-col transition-opacity duration-700 p-8 ${notify.show ? 'opacity-0' : 'opacity-100'}`}>
        <h1 className="text-4xl font-bold tracking-widest mb-8 text-center mt-4">PARKING SYSTEM <span className="text-yellow-400">POLINES</span></h1>
        <div className="flex-1 grid grid-cols-2 gap-8 max-w-7xl mx-auto w-full pb-8">
          <div className={`border-4 rounded-3xl p-12 flex flex-col justify-center items-center text-center ${isFull ? 'border-red-600 bg-red-950/30' : 'border-blue-600 bg-slate-900/50'}`}>
            <h2 className="text-3xl text-slate-400 mb-6 font-semibold">Sisa Slot Parkir</h2>
            {isFull ? (
              <span className="text-8xl font-black text-red-500 animate-pulse">PENUH</span>
            ) : (
              <div><span className="text-[10rem] font-black text-green-400">{availableSlots}</span><span className="text-6xl text-slate-500 ml-2">/ {MAX_SLOTS}</span></div>
            )}
          </div>
          <div className="bg-slate-900/80 border-2 border-slate-700 rounded-3xl p-6 flex flex-col h-full overflow-hidden">
            <h2 className="text-2xl font-bold mb-4 border-b border-slate-700 pb-4 text-center">Kendaraan Terparkir</h2>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left text-lg">
                <thead><tr className="text-slate-400"><th className="pb-3">Masuk</th><th className="pb-3">Pemilik</th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {logs.map((log) => (
                    <tr key={log.id}><td className="py-4 font-mono">{new Date(log.time_in).toLocaleTimeString('id-ID', { hour12: false })}</td><td className="py-4 font-bold">{log.members?.name} {log.is_manual && "(Tamu)"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div className={`absolute inset-0 flex items-center justify-center bg-black transition-opacity ${notify.show ? 'opacity-100 z-10' : 'opacity-0 -z-10'}`}>
        <div className={`border-4 rounded-3xl p-16 text-center w-11/12 max-w-5xl ${notify.type === 'IN' ? 'border-blue-500 bg-blue-950/20' : 'border-green-500 bg-green-950/20'}`}>
          <h2 className={`text-7xl font-black mb-6 ${notify.type === 'IN' ? 'text-blue-400' : 'text-green-400'}`}>{notify.type === 'IN' ? 'SELAMAT DATANG' : 'TERIMA KASIH'}</h2>
          <p className="text-4xl font-medium mb-8">{notify.name}</p>
          <div className="border-4 border-slate-600 rounded-xl py-6 mx-auto px-16 mb-8"><p className="text-8xl font-mono text-yellow-400 tracking-widest">{notify.plate_scanned}</p></div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 3. ROUTER UTAMA
// =====================================================================
export default function App() {
  const [currentView, setCurrentView] = useState('');
  useEffect(() => {
    const handleHash = () => setCurrentView(window.location.hash);
    handleHash(); 
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  if (currentView === '#admin') return <AdminWeb />;
  if (currentView === '#public') return <PublicWeb />;
  return (
    <div className="bg-slate-900 min-h-screen flex flex-col items-center justify-center font-sans text-white p-4">
      <h1 className="text-5xl font-bold text-yellow-400 mb-4 text-center">SCADA PARKIR BERBASIS IOT</h1>
      <p className="text-slate-400 mb-12 text-center text-lg">Pilih antarmuka sistem:</p>
      <div className="flex gap-6 w-full max-w-4xl justify-center">
        <button onClick={() => window.location.hash = 'admin'} className="bg-slate-800 border border-blue-900 p-8 rounded-2xl w-1/2">
          <h2 className="text-2xl font-bold text-blue-400 mb-2">Web Admin SCADA</h2>
          <p className="text-sm text-slate-400">Dasbor kontrol dan manajemen.</p>
        </button>
        <button onClick={() => window.location.hash = 'public'} className="bg-slate-800 border border-green-900 p-8 rounded-2xl w-1/2">
          <h2 className="text-2xl font-bold text-green-400 mb-2">Web Layar VMS</h2>
          <p className="text-sm text-slate-400">Tampilan gerbang (Live data).</p>
        </button>
      </div>
    </div>
  );
}