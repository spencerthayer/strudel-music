/**
 * Dynamic Noise Effect Generator
 * Creates a real-time animated noise overlay using canvas
 */

(function() {
  'use strict';
  
  // Configuration options
  const config = {
    opacity: 0.05,
    density: 3,
    fps: 8,
    intensity: 255,
    monochrome: true,
    blendMode: 'exclusion'
  };

  let canvas, ctx;
  let animationId;
  let lastFrameTime = 0;
  let frameDuration = 1000 / config.fps;

  /**
   * Initialize the noise effect
   */
  function init() {
    // Create canvas element
    canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '-50%';
    canvas.style.left = '-50%';
    canvas.style.width = '200%';
    canvas.style.height = '200%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '99999';
    canvas.style.opacity = config.opacity;
    canvas.style.mixBlendMode = config.blendMode;
    
    // Minimal iOS Safari optimization - don't interfere with scroll
    canvas.style.WebkitTransform = 'translateZ(0)';
    canvas.style.transform = 'translateZ(0)';
    
    // Get context
    ctx = canvas.getContext('2d', { 
      alpha: false,
      desynchronized: true 
    });
    
    // Add canvas to body
    document.body.appendChild(canvas);
    
    // Set up resize handler
    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    // iOS specific viewport change handling
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }
    
    // iOS scroll handling - pause during scroll to prevent flicker
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      let scrollTimer;
      let isScrolling = false;
      
      const handleScrollStart = () => {
        if (!isScrolling) {
          isScrolling = true;
          // Fade out the noise during scroll
          if (canvas) {
            canvas.style.transition = 'opacity 0.15s ease-out';
            canvas.style.opacity = '0';
          }
        }
        
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          // Fade back in after scroll stops
          isScrolling = false;
          if (canvas) {
            canvas.style.transition = 'opacity 0.3s ease-in';
            canvas.style.opacity = config.opacity.toString();
          }
        }, 100);
      };
      
      // Listen for any scroll-like events
      window.addEventListener('scroll', handleScrollStart, { passive: true });
      window.addEventListener('touchmove', handleScrollStart, { passive: true });
    }
    
    // Start animation
    animate(0);
  }

  /**
   * Handle window resize
   */
  function handleResize() {
    // Get the actual viewport dimensions
    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;
    
    // Use visualViewport if available (better for mobile)
    if (window.visualViewport) {
      viewportWidth = Math.max(window.visualViewport.width, window.innerWidth);
      viewportHeight = Math.max(window.visualViewport.height, window.innerHeight);
    }
    
    // For iOS Safari, try to get the maximum possible viewport
    // Account for the 200% canvas size (100% extra coverage on each side)
    const extraCoverage = 2.0;
    
    // Set canvas size based on viewport size and density, with extra coverage
    canvas.width = Math.ceil((viewportWidth * extraCoverage) / config.density);
    canvas.height = Math.ceil((viewportHeight * extraCoverage) / config.density);
    
    // Scale canvas back up with CSS if using lower density
    if (config.density > 1) {
      canvas.style.imageRendering = 'pixelated';
      canvas.style.imageRendering = 'crisp-edges';
    }
  }

  /**
   * Generate noise frame
   */
  function generateNoise() {
    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    
    // Generate random noise for each pixel
    for (let i = 0; i < data.length; i += 4) {
      if (config.monochrome) {
        // Monochrome noise
        const noise = Math.floor(Math.random() * config.intensity);
        data[i] = noise;     // Red
        data[i + 1] = noise; // Green
        data[i + 2] = noise; // Blue
      } else {
        // Colored noise
        data[i] = Math.floor(Math.random() * config.intensity);     // Red
        data[i + 1] = Math.floor(Math.random() * config.intensity); // Green
        data[i + 2] = Math.floor(Math.random() * config.intensity); // Blue
      }
      data[i + 3] = 255; // Alpha (fully opaque)
    }
    
    // Put the image data on the canvas
    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Animation loop
   */
  function animate(currentTime) {
    // Control frame rate
    if (currentTime - lastFrameTime >= frameDuration) {
      generateNoise();
      lastFrameTime = currentTime;
    }
    
    animationId = requestAnimationFrame(animate);
  }

  /**
   * Start the noise effect
   */
  function start() {
    if (!animationId) {
      animate(0);
    }
  }

  /**
   * Stop the noise effect
   */
  function stop() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  /**
   * Remove the noise effect completely
   */
  function destroy() {
    stop();
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('orientationchange', handleResize);
    
    // Remove iOS specific listeners
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', handleResize);
    }
    
    if (canvas && canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
  }

  /**
   * Update configuration
   */
  function updateConfig(newConfig) {
    Object.assign(config, newConfig);
    
    // Apply updated styles
    if (canvas) {
      canvas.style.opacity = `${config.opacity} !important`;
      canvas.style.mixBlendMode = `${config.blendMode} !important`;
      
      // Update frame duration if fps changed
      frameDuration = 1000 / config.fps;
      
      handleResize(); // Reapply density changes
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API for external control (optional)
  window.noiseEffect = {
    start,
    stop,
    destroy,
    updateConfig,
    config
  };
})();
