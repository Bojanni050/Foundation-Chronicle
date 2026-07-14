use std::ffi::c_void;

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
    GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

use windows::Media::Ocr::OcrEngine;
use windows::Graphics::Imaging::{SoftwareBitmap, BitmapPixelFormat};
use windows::Security::Cryptography::CryptographicBuffer;

pub fn capture_hwnd_ocr(hwnd: HWND) -> Option<Vec<String>> {
    unsafe {
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return None;
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return None;
        }

        let hdc_screen = GetDC(Some(hwnd));
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        let hbm_screen = CreateCompatibleBitmap(hdc_screen, width, height);

        let hbm_old = SelectObject(hdc_mem, hbm_screen.into());

        let blt = BitBlt(hdc_mem, 0, 0, width, height, Some(hdc_screen), 0, 0, SRCCOPY);
        
        let mut text_lines = None;

        if blt.is_ok() {
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height, // negative means top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default(); 1],
            };

            let mut pixels = vec![0u8; (width * height * 4) as usize];
            let res = GetDIBits(
                hdc_screen,
                hbm_screen,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut c_void),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            if res != 0 {
                text_lines = run_ocr(width, height, &pixels);
            }
        }

        SelectObject(hdc_mem, hbm_old);
        let _ = DeleteObject(hbm_screen.into());
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(Some(hwnd), hdc_screen);

        text_lines
    }
}

fn run_ocr(width: i32, height: i32, bgra_pixels: &[u8]) -> Option<Vec<String>> {
    let buffer = CryptographicBuffer::CreateFromByteArray(bgra_pixels).ok()?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width,
        height,
    ).ok()?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages().ok()?;
    let result = engine.RecognizeAsync(&bitmap).ok()?.get().ok()?;

    let mut lines = Vec::new();
    if let Ok(lines_collection) = result.Lines() {
        for line in lines_collection {
            if let Ok(text) = line.Text() {
                let trimmed = text.to_string();
                if !trimmed.trim().is_empty() {
                    lines.push(trimmed);
                }
            }
        }
    }

    Some(lines)
}
