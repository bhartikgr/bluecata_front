import { useEffect } from 'react';

const useScrollReveal = () => {
  useEffect(() => {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const delay = getComputedStyle(entry.target).getPropertyValue('--reveal-delay') || '0s';
          entry.target.style.transitionDelay = delay;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    // Yeh saare components ke '.js-reveal' elements ko dhoond lega
    document.querySelectorAll('.js-reveal').forEach(el => revealObserver.observe(el));

    return () => revealObserver.disconnect();
  }, []); // [] matlab ye sirf tab chalega jab component pehli baar load hoga
};

export default useScrollReveal;