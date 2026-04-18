import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

const MAX_SLOTS = 10; // Batas maksimal parkir
const ADMIN_PIN = 'POLINES123'; // PIN untuk masuk ke Web Admin

// =====================================================================
// 1. WEB ADMIN (PENDAFTARAN, MONITORING, EDIT & HISTORI)
// =====================================================================
function AdminWeb() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, members, history
  
  const [logs, setLogs] = useState([]);
  const [membersList, setMembersList] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, msg: '', isSuccess: true });
  
  // State untuk form
  const [formData, setFormData] = useState({ rfid_id: '', plat_nomor: '', nama: '' });
  const [editMode, setEditMode] = useState(false);
  const rfidInputRef = useRef(null);

  const availableSlots = Math.max(0, MAX_SLOTS - logs.length);

  // --- LOGIKA LOGIN & AUTO CLEANUP ---
  const handleLogin = (e) => {
    e.preventDefault();
    if (pinInput === ADMIN_PIN) {
      setIsAuthenticated(true);
      autoDeleteOldLogs(); // Jalankan pembersihan saat login
    } else {
      window.alert('PIN Salah! Akses ditolak.');
      setPinInput('');
    }
  };

  // Fungsi menghapus data parkir yang umurnya lebih dari 24 jam
  const autoDeleteOldLogs = async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('parking_logs').delete().lt('time_in', twentyFourHoursAgo);
    console.log("Pembersihan otomatis histori lama berhasil.");
  };

  // --- EFEK UTAMA & REALTIME ---
  useEffect(() => {
    if (!isAuthenticated) return;

    fetchInitialLogs();
    fetchMembers();
    fetchHistory();

    const channel = supabase.channel('admin-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'parking_logs' }, async (payload) => {
        fetchHistory(); // Update histori jika ada yang masuk
        if (payload.new.status === 'IN') {
            const { data } = await supabase.from('members').select('nama').eq('rfid_id', payload.new.rfid_id).single();
            const newLogWithMember = { ...payload.new, members: { nama: data ? data.nama : 'Tidak Terdaftar' } };
            setLogs(prevLogs => [newLogWithMember, ...prevLogs]);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parking_logs' }, async (payload) => {
        fetchHistory(); // Update histori jika ada yang keluar
        if (payload.new.status === 'OUT') {
           setLogs(prevLogs => prevLogs.filter(log => log.id !== payload.new.id));
        } else {
           const { data } = await supabase.from('members').select('nama').eq('rfid_id', payload.new.rfid_id).single();
           const updatedLogWithMember = { ...payload.new, members: { nama: data ? data.nama : 'Tidak Terdaftar' } };
           setLogs(prevLogs => prevLogs.map(log => log.id === payload.new.id ? updatedLogWithMember : log));
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [isAuthenticated]);

  // --- FUNGSI PENGAMBILAN DATA ---
  const fetchInitialLogs = async () => {
    setLoading(true);
    const { data } = await supabase.from('parking_logs').select('*, members(nama)').eq('status', 'IN').order('time_in', { ascending: false }); 
    if (data) setLogs(data);
    setLoading(false);
  };

  const fetchMembers = async () => {
    const { data } = await supabase.from('members').select('*').order('created_at', { ascending: false });
    if (data) setMembersList(data);
  };

  const fetchHistory = async () => {
    // Ambil semua log (IN & OUT) untuk tab histori
    const { data } = await supabase.from('parking_logs').select('*, members(nama)').order('time_in', { ascending: false }).limit(100);
    if (data) setHistoryLogs(data);
  };

  // --- HANDLER FORM & EDIT ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: name === 'plat_nomor' ? value.toUpperCase() : value }));
  };

  const showAlert = (msg, isSuccess) => {
    setAlert({ show: true, msg, isSuccess });
    setTimeout(() => setAlert({ show: false, msg: '', isSuccess: true }), 5000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (editMode) {
      // UPDATE DATA MEMBER
      const { error } = await supabase.from('members').update({ plat_nomor: formData.plat_nomor, nama: formData.nama }).eq('rfid_id', formData.rfid_id);
      if (error) showAlert('Gagal memperbarui data.', false);
      else {
        showAlert('Data member berhasil diperbarui!', true);
        setEditMode(false);
        setFormData({ rfid_id: '', plat_nomor: '', nama: '' });
        fetchMembers(); // Segarkan tabel member
      }
    } else {
      // INSERT DATA BARU
      const { error } = await supabase.from('members').insert([formData]);
      if (error) showAlert('Gagal mendaftar. RFID/Plat mungkin sudah ada.', false);
      else {
        showAlert('Akses berhasil diverifikasi dan disimpan!', true);
        setFormData({ rfid_id: '', plat_nomor: '', nama: '' });
        fetchMembers();
      }
    }
  };

  const editMember = (member) => {
    setFormData({ rfid_id: member.rfid_id, plat_nomor: member.plat_nomor, nama: member.nama });
    setEditMode(true);
    setActiveTab('dashboard'); // Pindah ke tab form
    window.scrollTo(0, 0);
  };

  const deleteMember = async (rfid_id) => {
    if(window.confirm('Yakin ingin menghapus akses RFID ini?')) {
      await supabase.from('members').delete().eq('rfid_id', rfid_id);
      showAlert('Member berhasil dihapus.', true);
      fetchMembers();
    }
  };

  // --- TAMPILAN LOGIN SCREEN ---
  if (!isAuthenticated) {
    return (
      <div className="bg-slate-900 min-h-screen flex items-center justify-center text-white font-sans">
        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 w-96 shadow-2xl">
          <h2 className="text-2xl font-bold text-blue-400 mb-6 text-center">🔐 Kunci Keamanan</h2>
          <form onSubmit={handleLogin}>
            <label className="block text-sm text-slate-400 mb-2">Masukkan PIN Admin:</label>
            <input 
              type="password" required autoFocus
              value={pinInput} onChange={(e) => setPinInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white text-center tracking-widest text-xl mb-4"
            />
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold transition-colors">Buka Kunci</button>
          </form>
          <button onClick={() => window.location.hash = ''} className="w-full text-slate-500 text-sm mt-4 hover:text-slate-300">Batal / Kembali</button>
        </div>
      </div>
    );
  }

  // --- TAMPILAN DASHBOARD ADMIN ---
  return (
    <div className="bg-slate-900 text-slate-100 font-sans min-h-screen flex flex-col">
      {/* HEADER & TABS */}
      <header className="bg-slate-800 border-b border-slate-700 p-6 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">DASHBOARD ADMIN SCADA</h1>
            <p className="text-sm text-slate-400 mt-1">Laboratorium Kendali - Politeknik Negeri Semarang</p>
          </div>
          <div className="flex gap-4 items-center">
            <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-lg text-center">
              <span className="text-xs text-slate-400 block uppercase tracking-wider">Sisa Slot Parkir</span>
              <span className={`text-xl font-bold ${availableSlots === 0 ? 'text-red-500' : 'text-green-400'}`}>
                {availableSlots} / {MAX_SLOTS}
              </span>
            </div>
            <button onClick={() => { setIsAuthenticated(false); window.location.hash = ''; }} className="text-sm bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-800 px-4 py-2 rounded transition-colors">Log Out</button>
          </div>
        </div>
        
        {/* TAB MENU */}
        <div className="max-w-7xl mx-auto flex gap-2">
          <button onClick={() => setActiveTab('dashboard')} className={`px-4 py-2 rounded-t-lg font-semibold transition-colors ${activeTab === 'dashboard' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>Monitor & Form</button>
          <button onClick={() => setActiveTab('members')} className={`px-4 py-2 rounded-t-lg font-semibold transition-colors ${activeTab === 'members' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>Manajemen Member</button>
          <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-t-lg font-semibold transition-colors ${activeTab === 'history' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>Histori 24 Jam</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 w-full flex-1">
        {/* TAB 1: DASHBOARD (FORM & LIVE) */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 lg:col-span-1 h-fit">
              <h2 className="text-xl font-semibold mb-4 text-white border-b border-slate-600 pb-2">
                {editMode ? <span className="text-yellow-400">Edit Data Akses</span> : "Pendaftaran Akses"}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">UID RFID</label>
                  <input type="text" name="rfid_id" required disabled={editMode} value={formData.rfid_id} onChange={handleInputChange} ref={rfidInputRef} placeholder="Tap kartu..." className={`w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-blue-500 outline-none ${editMode ? 'opacity-50 cursor-not-allowed' : ''}`} />
                  {editMode && <span className="text-xs text-slate-500">RFID tidak bisa diubah saat edit.</span>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Plat Nomor</label>
                  <input type="text" name="plat_nomor" required value={formData.plat_nomor} onChange={handleInputChange} placeholder="Contoh: H 1234 AB" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white uppercase focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Nama Pemilik</label>
                  <input type="text" name="nama" required value={formData.nama} onChange={handleInputChange} placeholder="Nama Lengkap" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="flex gap-2 mt-2">
                  <button type="submit" className={`w-full font-semibold py-2.5 rounded-lg transition-colors ${editMode ? 'bg-yellow-600 hover:bg-yellow-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                    {editMode ? 'Update Data' : 'Simpan Data'}
                  </button>
                  {editMode && (
                    <button type="button" onClick={() => { setEditMode(false); setFormData({ rfid_id: '', plat_nomor: '', nama: '' }); }} className="bg-slate-600 hover:bg-slate-500 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors">Batal</button>
                  )}
                </div>
              </form>
              {alert.show && ( <div className={`mt-4 p-3 rounded text-sm ${alert.isSuccess ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>{alert.msg}</div> )}
            </div>

            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 lg:col-span-2">
              <h2 className="text-xl font-semibold text-white border-b border-slate-600 pb-2 mb-4">Kendaraan di Dalam Area (Live)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-slate-300 uppercase tracking-wide">
                      <th className="p-3">Waktu Masuk</th>
                      <th className="p-3">UID RFID</th>
                      <th className="p-3">Nama Pemilik</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {loading ? <tr><td colSpan="4" className="p-4 text-center text-slate-500">Memuat...</td></tr> : logs.length === 0 ? <tr><td colSpan="4" className="p-4 text-center text-slate-500">Area parkir kosong.</td></tr> : logs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-800/50">
                        <td className="p-3 text-slate-300 font-mono">{new Date(log.time_in).toLocaleTimeString('id-ID', { hour12: false })}</td>
                        <td className="p-3 text-yellow-400 font-mono">{log.rfid_id}</td>
                        <td className="p-3 text-white font-semibold">{log.members?.nama || "Tidak Terdaftar"}</td>
                        <td className="p-3"><span className="px-2 py-1 bg-blue-900/50 text-blue-400 rounded text-xs font-bold">PARKIR (IN)</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: MANAJEMEN MEMBER */}
        {activeTab === 'members' && (
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
             <h2 className="text-xl font-semibold text-white border-b border-slate-600 pb-2 mb-4 flex justify-between">
               Daftar Akses Terdaftar 
               <span className="text-sm bg-slate-700 px-3 py-1 rounded-full">{membersList.length} Member</span>
             </h2>
             <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-slate-300 uppercase tracking-wide">
                      <th className="p-3">UID RFID</th>
                      <th className="p-3">Plat Nomor</th>
                      <th className="p-3">Nama Lengkap</th>
                      <th className="p-3 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {membersList.map(member => (
                      <tr key={member.rfid_id} className="hover:bg-slate-800/50">
                        <td className="p-3 text-yellow-400 font-mono">{member.rfid_id}</td>
                        <td className="p-3 text-slate-300 tracking-wider font-semibold">{member.plat_nomor}</td>
                        <td className="p-3 text-white">{member.nama}</td>
                        <td className="p-3 text-center">
                          <button onClick={() => editMember(member)} className="bg-blue-900/50 hover:bg-blue-600 text-blue-300 hover:text-white px-3 py-1 rounded mr-2 transition-colors">Edit</button>
                          <button onClick={() => deleteMember(member.rfid_id)} className="bg-red-900/50 hover:bg-red-600 text-red-300 hover:text-white px-3 py-1 rounded transition-colors">Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        )}

        {/* TAB 3: HISTORI PARKIR */}
        {activeTab === 'history' && (
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
             <h2 className="text-xl font-semibold text-white border-b border-slate-600 pb-2 mb-4 flex justify-between items-center">
               <span>Histori Keluar-Masuk <span className="text-sm text-slate-400 font-normal ml-2">(Otomatis terhapus setelah 24 jam)</span></span>
               <button onClick={fetchHistory} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded">Refresh Data</button>
             </h2>
             <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-slate-300 uppercase tracking-wide">
                      <th className="p-3">Waktu Masuk</th>
                      <th className="p-3">Waktu Keluar</th>
                      <th className="p-3">UID RFID</th>
                      <th className="p-3">Nama Pemilik</th>
                      <th className="p-3">Status Akhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {historyLogs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-800/50">
                        <td className="p-3 text-slate-300 font-mono">{new Date(log.time_in).toLocaleString('id-ID')}</td>
                        <td className="p-3 text-slate-400 font-mono">{log.time_out ? new Date(log.time_out).toLocaleString('id-ID') : '-'}</td>
                        <td className="p-3 text-yellow-400 font-mono">{log.rfid_id}</td>
                        <td className="p-3 text-white">{log.members?.nama || "Tamu"}</td>
                        <td className="p-3">
                           {log.status === 'IN' ? (
                             <span className="text-blue-400 font-semibold">Sedang Parkir</span>
                           ) : (
                             <span className="text-green-400 font-semibold">Selesai (OUT)</span>
                           )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 2. WEB PENGGUNA (LAYAR VMS DI GERBANG) - TETAP SAMA
// =====================================================================
function PublicWeb() {
  const [logs, setLogs] = useState([]);
  const [notify, setNotify] = useState({ show: false, type: '', nama: '', plat: '' });
  const timerRef = useRef(null);

  const availableSlots = Math.max(0, MAX_SLOTS - logs.length);
  const isFull = availableSlots === 0;

  useEffect(() => {
    const fetchSlotsAndData = async () => {
      const { data } = await supabase.from('parking_logs').select('*, members(nama)').eq('status', 'IN').order('time_in', { ascending: false });
      if (data) setLogs(data);
    };
    fetchSlotsAndData();

    const channel = supabase.channel('public-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'parking_logs' }, async (payload) => {
        if (payload.new.status === 'IN') {
          const { data } = await supabase.from('members').select('nama').eq('rfid_id', payload.new.rfid_id).single();
          const newLogWithMember = { ...payload.new, members: { nama: data ? data.nama : 'Tidak Terdaftar' } };
          setLogs(prev => [newLogWithMember, ...prev]); 
          triggerNotification(payload.new.rfid_id, 'IN'); 
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parking_logs' }, async (payload) => {
        if (payload.new.status === 'OUT') {
          setLogs(prev => prev.filter(log => log.id !== payload.new.id)); 
          triggerNotification(payload.new.rfid_id, 'OUT'); 
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const triggerNotification = async (rfid, type) => {
    const { data } = await supabase.from('members').select('nama, plat_nomor').eq('rfid_id', rfid).single();
    setNotify({ show: true, type: type, nama: data ? data.nama : 'Tamu Tak Dikenal', plat: data ? data.plat_nomor : '---' });

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setNotify({ show: false, type: '', nama: '', plat: '' }); }, 7000);
  };

  return (
    <div className="bg-black text-white font-sans h-screen flex flex-col relative overflow-hidden">
      <button onClick={() => window.location.hash = ''} className="absolute top-4 left-4 text-xs text-slate-800 hover:text-slate-500 z-50">Keluar</button>

      <div className={`absolute inset-0 flex flex-col transition-opacity duration-700 p-8 ${notify.show ? 'opacity-0' : 'opacity-100'}`}>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-300 tracking-widest mb-8 text-center mt-4">
          SISTEM PARKIR CERDAS <span className="text-yellow-400">POLINES</span>
        </h1>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 max-w-7xl mx-auto w-full h-full pb-8">
          
          <div className={`border-4 rounded-3xl p-12 flex flex-col justify-center items-center text-center shadow-[0_0_40px_rgba(0,0,0,0.5)] ${isFull ? 'border-red-600 bg-red-950/30' : 'border-blue-600 bg-slate-900/50'}`}>
            <h2 className="text-3xl text-slate-400 mb-6 font-semibold uppercase">Sisa Slot Parkir</h2>
            {isFull ? (
              <div className="animate-pulse">
                <span className="text-8xl font-black text-red-500 tracking-tighter">PENUH</span>
                <p className="text-2xl text-red-300 mt-6">Mohon tunggu kendaraan keluar.</p>
              </div>
            ) : (
              <div>
                <span className="text-[10rem] leading-none font-black text-green-400 tracking-tighter">{availableSlots}</span>
                <span className="text-6xl text-slate-500 font-medium ml-2">/ {MAX_SLOTS}</span>
                <p className="text-2xl text-blue-300 mt-8 animate-pulse">Sistem Auto-Gate Aktif. Silakan Tap Kartu.</p>
              </div>
            )}
          </div>

          <div className="bg-slate-900/80 border-2 border-slate-700 rounded-3xl p-6 flex flex-col h-full overflow-hidden">
            <h2 className="text-2xl font-bold text-slate-300 mb-4 border-b border-slate-700 pb-4 text-center">Daftar Kendaraan Terparkir</h2>
            <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar">
              <table className="w-full text-left border-collapse text-lg">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="pb-3 pt-2">Waktu Masuk</th>
                    <th className="pb-3 pt-2">Nama Pemilik</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {logs.length === 0 ? ( <tr><td colSpan="2" className="py-8 text-center text-slate-500 text-xl">Area parkir masih kosong.</td></tr> ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="transition-colors hover:bg-slate-800/50">
                        <td className="py-4 text-slate-300 font-mono text-xl">{new Date(log.time_in).toLocaleTimeString('id-ID', { hour12: false })}</td>
                        <td className="py-4 font-bold text-white text-xl">{log.members?.nama || "Tamu"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className={`absolute inset-0 flex flex-col items-center justify-center bg-black transition-opacity duration-500 ${notify.show ? 'opacity-100 z-10' : 'opacity-0 -z-10'}`}>
        <div className={`border-4 rounded-3xl p-16 text-center w-11/12 max-w-5xl shadow-[0_0_100px_rgba(0,0,0,0.8)] ${notify.type === 'IN' ? 'border-blue-500 bg-blue-950/20' : 'border-green-500 bg-green-950/20'}`}>
          <h2 className={`text-6xl md:text-7xl font-black mb-6 ${notify.type === 'IN' ? 'text-blue-400' : 'text-green-400'}`}>{notify.type === 'IN' ? 'SELAMAT DATANG' : 'TERIMA KASIH'}</h2>
          <p className="text-4xl text-white font-medium mb-8">{notify.nama}</p>
          <div className="bg-black border-4 border-slate-600 rounded-xl py-6 mx-auto w-fit px-16 mb-8">
            <p className="text-7xl md:text-8xl font-mono font-bold text-yellow-400 tracking-widest">{notify.plat}</p>
          </div>
          <p className="text-3xl text-slate-400">{notify.type === 'IN' ? 'Palang terbuka, silakan masuk perlahan.' : 'Hati-hati di jalan, sampai jumpa kembali.'}</p>
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
      <h1 className="text-3xl md:text-5xl font-bold text-yellow-400 mb-4 text-center">SCADA PARKIR BERBASIS IOT</h1>
      <p className="text-slate-400 mb-12 text-center text-lg">Silakan pilih antarmuka sistem yang ingin dibuka:</p>
      <div className="flex flex-col md:flex-row gap-6 w-full max-w-4xl justify-center">
        <button onClick={() => window.location.hash = 'admin'} className="bg-slate-800 hover:bg-slate-700 border border-blue-900/50 hover:border-blue-500 p-8 rounded-2xl flex flex-col items-center text-center transition-all group flex-1">
          <div className="bg-blue-900/30 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
            <svg className="w-12 h-12 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
          </div>
          <h2 className="text-2xl font-bold text-blue-400 mb-2">Web Admin SCADA</h2>
          <p className="text-sm text-slate-400">Dasbor kontrol, manajemen member, dan histori harian. Dilindungi kode keamanan.</p>
        </button>
        <button onClick={() => window.location.hash = 'public'} className="bg-slate-800 hover:bg-slate-700 border border-green-900/50 hover:border-green-500 p-8 rounded-2xl flex flex-col items-center text-center transition-all group flex-1">
          <div className="bg-green-900/30 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
            <svg className="w-12 h-12 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
          </div>
          <h2 className="text-2xl font-bold text-green-400 mb-2">Web Layar Pengguna</h2>
          <p className="text-sm text-slate-400">Tampilan VMS publik. Menampilkan sisa slot parkir dan tabel kendaraan secara Live.</p>
        </button>
      </div>
    </div>
  );
}