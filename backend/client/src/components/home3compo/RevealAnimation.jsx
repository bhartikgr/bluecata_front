import { useEffect } from 'react';

export const useScrollReveal = () => {
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
    
    document.querySelectorAll('.js-reveal').forEach(el => revealObserver.observe(el));
    
    return () => revealObserver.disconnect();
  }, []);
};