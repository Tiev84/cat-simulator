# Mèo Simulator

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
| F | Mở cánh và bay / cất cánh đi (cánh chỉ hiện khi bật) — bay: Space lên, Shift xuống |
| Di chuột | Xoay camera (bấm vào game để khoá con trỏ, Esc để thả) · lăn chuột: zoom |
| Q | Xem lại nhiệm vụ |
| C | Chế độ quay phim · H ẩn giao diện · F3 thông số |

Mèo đứng yên khoảng 7 giây sẽ tự ngồi xuống.

## Săn chuột & mở khoá

Mỗi con chuột bắt được = 1 điểm (lưu trong trình duyệt).

Ronaldo và Messi là NPC đi dạo trong khu phố đầu tiên (đi bộ bằng hoạt ảnh quay từ người thật — clip Idle/Walk/Run của model Soldier trong ví dụ three.js, chuyển sang từng nhân vật). Mèo vồ trúng thì họ hô câu cửa miệng.

- **5 chuột** → cánh quạt trực thăng. Mỗi lần bật cánh (F) phát câu meme "helicopter helicopter".
- **10 chuột** → mèo Tom (đi 2 chân, giữ E để rón rén). Bật cánh thì Tom bay bằng áo choàng dơi màu tím.
- **15 chuột** → OIIA Cat (mèo mướp meme). Giữ E là nằm thành ổ bánh mì (giấu chân) và xoay tít kèm tiếng "u i i a i".

**Âm thanh "helicopter helicopter":** phát từ `sounds/helicopter.mp3` (clip meme gốc do bạn cung cấp). Muốn đổi
âm khác thì thay file này (cũng nhận `.m4a`, `.wav`, `.ogg`). Nếu xoá file, trình duyệt sẽ tự đọc
"Helicopter, helicopter!" bằng giọng máy. Lưu ý: clip thuộc bản quyền người làm meme — nếu đưa game lên mạng
công khai, cân nhắc thay bằng âm thanh tự làm.

**Âm thanh trong `sounds/`:** `meow.mp3` (mèo kêu — mỗi lần chọn ngẫu nhiên 1 trong các tiếng trong file, chỉnh cao/trầm theo từng con),
`tom.mp3` (Tom hét), `helicopter.mp3`, `oiia.mp3` (lặp trong lúc xoay). Thiếu file nào thì game tự tổng hợp âm thay thế.

Xoá điểm để chơi lại từ đầu: mở Console của trình duyệt, chạy `localStorage.clear()` rồi tải lại trang.

## Cấu trúc

| File | Nội dung |
|---|---|
| `js/main.js` | Khởi động, menu chọn skin (ảnh thumbnail render trực tiếp), HUD, vòng lặp game |
| `js/models.js` | Nạp model 3D (`models/`): mèo bicolor có xương cho Mèo Cam/Mun/Tuxedo/Ú (đổi màu bằng shader, chuyển động bằng cách xoay xương), Mèo OIIA (morph nằm ổ bánh mì khi xoay), Maxwell (có điệu nhảy gốc) |
| `js/cat.js` | Các skin mèo dựng bằng code: thân liền khối (loft), lông có sheen + vân sợi, đầu kiểu thật / kiểu hoạt hình (Tom) / low-poly (Maxwell); hoa văn sọc, yếm, vớ; animation |
| `js/wings.js` | 6 loại cánh lông vũ + cánh quạt trực thăng + áo choàng dơi của Tom |
| `js/grass.js` | Cỏ GPU (hàng trăm nghìn lá), gió, mèo rẽ cỏ khi đi qua |
| `js/terrain.js`, `js/noise.js` | Đồi vô tận, mặt đường và thị trấn san phẳng (cùng một hàm độ cao cho JS và shader) |
| `js/props.js` | Cây, đá, bụi, hoa sinh theo từng ô đất |
| `js/city.js` | Khu phố "Cartoon City" (ithappy, bản Free cho Godot) đặt ở thị trấn đầu tiên: `models/city/city.json` được chuyển tự động từ cảnh Godot (330 mảnh, 79 model), vẽ theo nhóm (instancing), có va chạm, đứng được trên vỉa hè và nóc xe |
| `js/town.js` | Thị trấn: nhà, đèn đường, ô tô, cây trong vườn, va chạm với nhà |
| `js/autorig.js` | Tự gắn xương cho model tĩnh (Tom, Messi): dò hông, gối, vai, khuỷu từ hình dạng rồi gán từng đỉnh vào xương gần nhất |
| `js/people.js` | Tom (chơi được) và NPC Ronaldo/Messi: chuyển hoạt ảnh mocap sang khung xương bất kỳ (retarget theo tư thế chữ T) |
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

## Model 3D

Khu phố trong `models/city/` từ gói **Cartoon City Free** của ithappy. Các model khác trong `models/` do bạn tải về (Sketchfab): mèo bicolor có xương, mèo OIIA, Maxwell, Tom (bản GameCube), Ronaldo, Messi, con dê.
Bản quyền thuộc tác giả từng model — dùng cho game chơi vui với bạn bè. Mèo Lực Sĩ vẫn dựng bằng code.
Nếu model không tải được, game tự dùng mèo dựng bằng code thay thế.

## Hiệu năng

Mặc định đồ hoạ Trung bình. Bóng đổ vẽ lại cách 1 khung hình, cỏ giảm khi ở trong phố, và nếu game chạy dưới ~32 FPS vài giây liền thì tự giảm một mức đồ hoạ.

Skybox ban ngày trong `models/sky/` (ảnh trời xanh có mây), mờ dần lúc hoàng hôn/ban đêm/mưa để thấy trời sao.
