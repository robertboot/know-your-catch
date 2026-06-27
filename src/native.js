/* Native bridge — uses Capacitor plugins on iOS, web APIs in the browser.
   Same call sites work in both, so dev in Safari and prod in the iOS app
   share one codebase. */
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export const isNative = () => Capacitor.isNativePlatform();

/** Resolve to { lat, lon }; reject on denial / timeout / no GPS. */
export async function getLocation(opts = {}) {
  const o = { enableHighAccuracy: true, timeout: 60000, maximumAge: 60000, ...opts };
  if (isNative()) {
    const pos = await Geolocation.getCurrentPosition(o);
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  }
  if (!('geolocation' in navigator)) throw new Error('GPS not available');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(new Error(err.message || 'GPS denied')),
      o,
    );
  });
}

/** Resolve to a data URL of the chosen photo, or null if the user cancelled. */
export async function getPhoto() {
  if (isNative()) {
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        source: CameraSource.Prompt,   // "Take Photo" / "Choose from Library"
        resultType: CameraResultType.DataUrl,
      });
      return photo.dataUrl || null;
    } catch (e) {
      return null; // user cancelled
    }
  }
  // Web fallback: programmatically open a file picker that prefers the camera.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(f);
    };
    // Cancellation in file input doesn't fire reliably; just resolve null on no-pick.
    input.click();
  });
}
