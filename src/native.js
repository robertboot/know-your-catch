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

/** Resolve to a data URL of the chosen photo, or null if the user cancelled.
    Options:
      source =
        'prompt' → iOS system picker offering Take Photo / Choose from
                   Library. Default and preferred entry — the user
                   should always be able to pick a library photo
                   without a separate app-level menu.
        'camera' → camera only, no library option
        'library' → library only, no camera
    Legacy: cameraOnly=true is aliased to source='camera' for older
    call sites. */
export async function getPhoto({ source = 'prompt', cameraOnly = false } = {}) {
  const effective = cameraOnly ? 'camera' : source;
  if (isNative()) {
    try {
      const capacitorSource =
        effective === 'camera'  ? CameraSource.Camera :
        effective === 'library' ? CameraSource.Photos :
                                  CameraSource.Prompt;
      const photo = await Camera.getPhoto({
        // Max JPEG quality Capacitor's Camera plugin will hand us.
        // Every subsequent re-encode (thumb, cloud upload) is pure
        // loss on top of this baseline, so we start high. 100 stalls
        // on some devices; 95 is the safe ceiling.
        quality: 95,
        allowEditing: false,
        source: capacitorSource,
        resultType: CameraResultType.DataUrl,
        // Dual-write: when the source is the camera the full-res
        // capture also lands in the iOS Photos library. Anglers
        // expect their fish photos in Recents. The app keeps its own
        // copy in Filesystem for fast render / share regardless.
        // Silent skip if the user denies the "add to Photos" permission.
        saveToGallery: true,
      });
      return photo.dataUrl || null;
    } catch (e) {
      return null; // user cancelled
    }
  }
  // Web fallback: programmatically open a file picker. Prefer camera
  // when source='camera', otherwise let the user pick either camera
  // or an existing library photo. Cancellation doesn't fire reliably
  // on file inputs; just resolve null on no-pick.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (effective === 'camera') input.capture = 'environment';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(f);
    };
    input.click();
  });
}
