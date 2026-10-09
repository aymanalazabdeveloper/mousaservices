(() => {
  const button = document.getElementById('installAppButton');
  const help = document.getElementById('installAppHelp');
  if (!button || !help) return;

  let installPrompt = null;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  function showHelp(message) {
    help.textContent = message;
    help.hidden = false;
  }

  if (isStandalone) {
    button.textContent = 'التطبيق مثبت بالفعل';
    button.disabled = true;
    button.setAttribute('aria-label', 'التطبيق مثبت بالفعل');
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
    button.textContent = 'تثبيت التطبيق';
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    button.textContent = 'تم تثبيت التطبيق';
    button.disabled = true;
    showHelp('تقدر دلوقتي تفتح المنظومة من الأيقونة الموجودة على الشاشة الرئيسية.');
  });

  button.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      if (choice && choice.outcome === 'accepted') {
        button.textContent = 'جاري تثبيت التطبيق...';
      } else {
        showHelp('لم يتم التثبيت. تقدر تجرب مرة أخرى في أي وقت.');
      }
      return;
    }

    if (isIOS) {
      showHelp('لتثبيت المنظومة على iPhone: افتح الموقع في Safari، واضغط زر المشاركة (Share)، ثم اختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen)، وبعدها اضغط «إضافة».');
      return;
    }

    showHelp('لو خيار التثبيت مش ظاهر، افتح قائمة المتصفح ⋮ ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية». تأكد من فتح الموقع عبر HTTPS.');
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch((error) => {
        console.error('PWA service worker registration failed:', error);
      });
    });
  }
})();
