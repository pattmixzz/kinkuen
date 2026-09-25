# กินให้ขึ้น

เว็บแอปส่วนตัวสำหรับบันทึกการกินและน้ำหนัก (GitHub Pages + Google Apps Script + Google Sheets)

## ตั้งค่า
1. แก้ `config.js` ใส่ Web app URL จาก Apps Script
2. Push ขึ้น GitHub แล้วเปิด Settings → Pages → Deploy from branch `main` / root
3. เปิดลิงก์ในมือถือ แล้วเพิ่มไปยังหน้าจอโฮม

## อัปเดตโค้ดหน้าเว็บ
แก้ไฟล์แล้ว push ได้เลย ถ้ามือถือยังเห็นของเก่า ให้เปลี่ยน `CACHE = 'kinkuen-v1'` ใน `sw.js` เป็นเลขใหม่
