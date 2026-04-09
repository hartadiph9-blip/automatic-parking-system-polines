import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

function App() {
  // === STATE MANAGEMENT ===
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, msg: '', isSuccess: true });
  
  // State untuk form input
  const [formData, setFormData] = useState({
    rfid_id: '',
    plat_nomor: '',
    nama: ''
  });

  const rfidInputRef = useRef(null);

  // === FETCH DATA AWAL & REALTIME SUBSCRIPTION ===
  useEffect(() => {
    fetchInitialLogs();

    const channel = supabase.channel('custom-all-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'parking_logs' }, async (payload) => {
        console.log('Kendaraan Masuk:', payload.new);
        
        // Hanya tampilkan jika statusnya IN
        if (payload.new.status === 'IN') {
            const { data } = await supabase.from('members').select('nama').eq('rfid_id', payload.new.rfid_id).single();
            const newLogWithMember = { ...payload.new, members: { nama: data ? data.nama : 'Tidak Terdaftar' } };
            
            setLogs(prevLogs => [newLogWithMember, ...prevLogs]);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parking_logs' }, async (payload) => {
        console.log('Kendaraan Keluar / Update:', payload.new);
        
        // Jika statusnya berubah menjadi 'OUT', hapus baris ini dari layar
        if (payload.new.status === 'OUT') {
           setLogs(prevLogs => prevLogs.filter(log => log.id !== payload.new.id));
        } else {
           // Jika ada update tapi status masih IN
           const { data } = await supabase.from('members').select('nama').eq('rfid_id', payload.new.rfid_id).single();
           const updatedLogWithMember = { ...payload.new, members: { nama: data ? data.nama : 'Tidak Terdaftar' } };
           setLogs(prevLogs => prevLogs.map(log => log.id === payload.new.id ? updatedLogWithMember : log));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchInitialLogs = async () => {
    setLoading(true);
    
    // Tarik hanya yang berstatus 'IN'
    const { data, error } = await supabase
      .from('parking_logs')
      .select('*, members(nama)')
      .eq('status', 'IN') 
      .order('time_in', { ascending: false }); 

    if (data) setLogs(data);
    if (error) console.error(error);
    setLoading(false);
  };

  // === HANDLER FORM (YANG TADI SEMPAT HILANG) ===
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ 
      ...prev, 
      [name]: name === 'plat_nomor' ? value.toUpperCase() : value 
    }));
  };

  const showAlert = (msg, isSuccess) => {
    setAlert({ show: true, msg, isSuccess });
    setTimeout(() => setAlert({ show: false, msg: '', isSuccess: true }), 5000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const { data, error } = await supabase
      .from('members')
      .insert([formData]);

    if (error) {
      console.error(error);
      showAlert('Gagal mendaftar. RFID atau Plat mungkin sudah ada.', false);
    } else {
      showAlert('Akses RFID & Plat berhasil diverifikasi dan disimpan!', true);
      setFormData({ rfid_id: '', plat_nomor: '', nama: '' });
      if (rfidInputRef.current) rfidInputRef.current.focus();
    }
  };

  // === TAMPILAN UI ===
  return (
    <div className="bg-slate-900 text-slate-100 font-sans min-h-screen">
      {/* HEADER */}
      <header className="bg-slate-800 border-b border-slate-700 p-6 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-blue-400 tracking-wider">SISTEM OTOMASI PARKIR IOT</h1>
            <p className="text-sm text-slate-400 mt-1">
              Laboratorium Kendali & SCADA - <span className="font-bold text-yellow-400">Politeknik Negeri Semarang</span>
            </p>
          </div>
          <div className="flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full border border-slate-700">
            <div className="w-3 h-3 bg-green-500 rounded-full live-dot"></div>
            <span className="text-sm font-medium text-green-400">System Online</span>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
        
        {/* PANEL KIRI: FORM */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700 lg:col-span-1 h-fit">
          <h2 className="text-xl font-semibold mb-4 text-white border-b border-slate-600 pb-2">Verifikasi & Daftar RFID</h2>
          <p className="text-sm text-slate-400 mb-6">Tap kartu pada reader (USB) atau input manual untuk mendaftarkan akses kendaraan.</p>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">UID RFID</label>
              <input 
                type="text" name="rfid_id" required 
                value={formData.rfid_id} onChange={handleInputChange} ref={rfidInputRef}
                placeholder="Tap kartu..." 
                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Plat Nomor</label>
              <input 
                type="text" name="plat_nomor" required 
                value={formData.plat_nomor} onChange={handleInputChange}
                placeholder="Contoh: H 1234 AB" 
                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white uppercase focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Nama Pemilik</label>
              <input 
                type="text" name="nama" required 
                value={formData.nama} onChange={handleInputChange}
                placeholder="Nama Mahasiswa/Dosen" 
                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition-colors mt-2">
              Daftarkan Akses
            </button>
          </form>

          {/* ALERT MESSAGES */}
          {alert.show && (
            <div className={`mt-4 p-3 rounded text-sm font-medium block ${alert.isSuccess ? 'bg-green-900/50 text-green-400 border border-green-800' : 'bg-red-900/50 text-red-400 border border-red-800'}`}>
              {alert.msg}
            </div>
          )}
        </div>

        {/* PANEL KANAN: TABEL */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700 lg:col-span-2">
          <div className="flex justify-between items-center border-b border-slate-600 pb-2 mb-4">
            <h2 className="text-xl font-semibold text-white">Live Monitoring Gate</h2>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">Update Real-time via Supabase</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-300 text-sm uppercase tracking-wide">
                  <th className="p-3 rounded-tl-lg">Waktu</th>
                  <th className="p-3">UID RFID</th>
                  <th className="p-3">Nama Pemilik</th>
                  <th className="p-3">Status Palang</th>
                  <th className="p-3 rounded-tr-lg">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 text-sm">
                
                {loading ? (
                  <tr><td colSpan="5" className="p-4 text-center text-slate-500">Memuat data realtime...</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan="5" className="p-4 text-center text-slate-500">Belum ada aktivitas hari ini.</td></tr>
                ) : (
                  logs.map((log) => {
                    const timeRaw = log.time_out ? log.time_out : log.time_in;
                    const timeFormatted = new Date(timeRaw).toLocaleTimeString('id-ID', { hour12: false });
                    
                    return (
                      <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-3 text-slate-300 font-mono">{timeFormatted}</td>
                        <td className="p-3 font-mono text-yellow-400">{log.rfid_id}</td>
                        <td className="p-3 font-semibold text-slate-200">
                          {log.members?.nama || "Tidak Terdaftar"}
                        </td>
                        <td className="p-3">
                          {log.status === 'IN' ? (
                            <span className="px-2 py-1 bg-blue-900/50 text-blue-400 rounded text-xs font-bold border border-blue-800">GATE IN (UHF)</span>
                          ) : (
                            <span className="px-2 py-1 bg-purple-900/50 text-purple-400 rounded text-xs font-bold border border-purple-800">GATE OUT (OCR+TAG)</span>
                          )}
                        </td>
                        <td className="p-3 text-slate-400">
                          {log.status === 'IN' ? 'Masuk area parkir' : 'Telah diverifikasi kamera'}
                        </td>
                      </tr>
                    );
                  })
                )}
                
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;