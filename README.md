# Cat Simulator

Game 3D low-poly chạy trên trình duyệt: điều khiển một chú mèo đi dạo, ngủ, bay và săn chuột trên đồng cỏ vô tận có các thị trấn nhỏ.
Không cần cài gì thêm — chỉ HTML/JS thuần + three.js nạp từ CDN.

## Chạy trên máy

```bash
python3 serve.py
```

Mở http://127.0.0.1:8800 (cần mạng để tải three.js và font lần đầu).

## Điều khiển

| Phím | Hành động |
|---|---|
| WASD / mũi tên | Đi |
| Shift | Chạy |
| Space | Nhảy |
| Chuột trái | Vồ chuột |
| E | Kêu meo · giữ: liếm lông (Buff: gồng cơ, Tom: rón rén, Maxwell & OIIA: xoay vòng) |
| Z | Ngủ |
| F | Bật/tắt cánh — bay: Space lên, Shift xuống (chạm đất + Shift là hạ cánh) |
| Di chuột | Xoay camera (bấm vào game để khoá con trỏ, Esc để thả) · lăn chuột: zoom |
| Q | Xem lại nhiệm vụ |
| C | Chế độ quay phim · H ẩn giao diện · F3 thông số |

Mèo đứng yên khoảng 7 giây sẽ tự ngồi xuống.

## Săn chuột & mở khoá

Mỗi con chuột bắt được = 1 điểm (lưu trong trình duyệt).

- **5 chuột** → cánh quạt trực thăng. Mỗi lần bật cánh (F) phát câu meme "helicopter helicopter".
- **10 chuột** → mèo Tom (đi 2 chân, giữ E để rón rén). Bật cánh thì Tom bay bằng áo choàng dơi màu tím.
- **15 chuột** → OIIA Cat (mèo mướp meme). Giữ E là xoay tít kèm tiếng "u i i a i".

**Âm thanh "helicopter helicopter":** phát từ `sounds/helicopter.mp3` (clip meme gốc do bạn cung cấp). Muốn đổi
âm khác thì thay file này (cũng nhận `.m4a`, `.wav`, `.ogg`). Nếu xoá file, trình duyệt sẽ tự đọc
"Helicopter, helicopter!" bằng giọng máy. Lưu ý: clip thuộc bản quyền người làm meme — nếu đưa game lên mạng
công khai, cân nhắc thay bằng âm thanh tự làm.

**Âm thanh OIIA:** mặc định game tự tổng hợp tiếng "u i i a i". Có clip gốc thì đặt vào `sounds/oiia.mp3`,
game sẽ phát lặp clip đó trong lúc mèo xoay.

Xoá điểm để chơi lại từ đầu: mở Console của trình duyệt, chạy `localStorage.clear()` rồi tải lại trang.

## Cấu trúc

| File | Nội dung |
|---|---|
| `js/main.js` | Khởi động, menu chọn skin (ảnh thumbnail render trực tiếp), HUD, vòng lặp game |
| `js/cat.js` | 6 skin mèo dựng bằng code: dáng 4 chân (kitten/chonk), 2 chân (Buff), ổ bánh mì (Maxwell); hoa văn sọc/yếm trắng/vớ trắng; animation |
| `js/wings.js` | 6 loại cánh lông vũ + cánh quạt trực thăng + áo choàng dơi của Tom |
| `js/grass.js` | Cỏ GPU (hàng trăm nghìn lá), gió, mèo rẽ cỏ khi đi qua |
| `js/terrain.js`, `js/noise.js` | Đồi vô tận, mặt đường và thị trấn san phẳng (cùng một hàm độ cao cho JS và shader) |
| `js/props.js` | Cây, đá, bụi, hoa sinh theo từng ô đất |
| `js/town.js` | Thị trấn: nhà, đèn đường, ô tô, cây trong vườn, va chạm với nhà |
| `js/mice.js` | Chuột: đi lang thang, gặm, bỏ chạy khi mèo tới gần, bị bắt khi mèo vồ |
| `js/sky.js` | Bầu trời, mặt trời/trăng/sao, ngày-đêm, mây, mưa, sấm chớp |
| `js/effects.js` | Mưa, đom đóm/phấn hoa, bướm, chữ "meow"/"z" |
| `js/audio.js` | Toàn bộ âm thanh tạo bằng Web Audio (gió, mưa, chim, dế, meo, gừ gừ, vỗ cánh) |

## Bản online

- Chơi: https://tiev84.github.io/cat-simulator/
- Code: https://github.com/Tiev84/cat-simulator (GitHub Pages tự đăng bản mới mỗi lần đẩy code lên nhánh `main`)

Cập nhật: sửa code trên máy, thử bằng `python3 serve.py`, rồi

```bash
git add -A && git commit -m "mô tả thay đổi" && git push
```

Khoảng 1 phút sau link online có bản mới. Người chơi tải lại trang (Cmd+Shift+R) nếu vẫn thấy bản cũ.
