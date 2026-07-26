/* =========================================================
   xNico Dashboard — spatial.js
   WebGL Data Nebula & GSAP Spatial Computing Integration
   ========================================================= */

let scene, camera, renderer, particles, composer;
let mouse = new THREE.Vector2();
let targetMouse = new THREE.Vector2();
let uniforms;

document.addEventListener('DOMContentLoaded', () => {
    initWebGLScene();
});

function initWebGLScene() {
    const canvas = document.getElementById('webgl-scene');
    if (!canvas || typeof THREE === 'undefined') return;

    // 1. Scene & Camera
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#050507');
    scene.fog = new THREE.FogExp2('#050507', 0.001);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 3000);
    camera.position.set(0, 0, 800);

    // 2. Data Nebula (InstancedMesh + Custom GLSL)
    const count = 2500;
    const geometry = new THREE.IcosahedronGeometry(3, 0);
    
    uniforms = {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector3(0, 0, 0) },
        uColorA: { value: new THREE.Color('#00F0FF') },
        uColorB: { value: new THREE.Color('#FF0055') }
    };

    const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: `
            uniform float uTime;
            uniform vec3 uMouse;
            varying vec2 vUv;
            varying vec3 vColor;
            
            void main() {
                vUv = uv;
                
                // Instance Matrix transforming
                vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
                
                // Subtle float based on time and position
                worldPosition.y += sin(worldPosition.x * 0.01 + uTime * 2.0) * 15.0;
                
                // Mouse repel logic
                float dist = distance(worldPosition.xy, uMouse.xy);
                if(dist < 150.0 && dist > 0.1) {
                    vec2 dir = normalize(worldPosition.xy - uMouse.xy);
                    worldPosition.xy += dir * (150.0 - dist) * 0.1;
                }
                
                // Color variation based on world position
                float mixFactor = (sin(worldPosition.x * 0.005 + uTime) + 1.0) * 0.5;
                vColor = mixFactor > 0.5 ? vec3(0.0, 0.94, 1.0) : vec3(1.0, 0.0, 0.33); // Cyan to Neon Pink
                
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            varying vec3 vColor;
            void main() {
                // Iridescent glowing rim
                float dist = distance(vUv, vec2(0.5));
                float alpha = smoothstep(0.5, 0.2, dist);
                gl_FragColor = vec4(vColor, alpha * 0.6);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    particles = new THREE.InstancedMesh(geometry, material, count);
    
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        dummy.position.set(
            (Math.random() - 0.5) * 3000,
            (Math.random() - 0.5) * 3000,
            (Math.random() - 0.5) * 2000 - 500
        );
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        dummy.updateMatrix();
        particles.setMatrixAt(i, dummy.matrix);
    }
    scene.add(particles);

    // 3. Renderer Setup
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 4. AAA Post-Processing (Bloom + DoF proxy via blur)
    if (typeof THREE.EffectComposer !== 'undefined') {
        const renderScene = new THREE.RenderPass(scene, camera);
        const bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.2, 0.4, 0.85);
        bloomPass.threshold = 0.1;
        bloomPass.strength = 1.2;
        bloomPass.radius = 0.5;

        composer = new THREE.EffectComposer(renderer);
        composer.addPass(renderScene);
        composer.addPass(bloomPass);
    }

    // 5. Listeners
    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('mousemove', onMouseMove, false);
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    onWindowResize(); // Force initial FOV
    
    // Shader warm-up frame
    if (composer) composer.render();
    else renderer.render(scene, camera);

    // 6. Preloader Reveal
    const loader = document.getElementById('auth-loading');
    if(loader && typeof gsap !== 'undefined') {
        gsap.to(loader, {
            opacity: 0,
            duration: 1,
            delay: 1.5,
            onComplete: () => loader.classList.add('hidden')
        });
    }

    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = window.innerWidth < 768 ? 90 : 60;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(event) {
    targetMouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    targetMouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onTouchMove(event) {
    if (event.touches.length > 0) {
        targetMouse.x = (event.touches[0].clientX / window.innerWidth) * 2 - 1;
        targetMouse.y = -(event.touches[0].clientY / window.innerHeight) * 2 + 1;
    }
}

// Global camera flight hook for app.js router
window.__flyCameraToRoute = function(route) {
    if (typeof gsap === 'undefined' || !camera) return;
    
    let targetZ = 800;
    let targetY = 0;
    let targetX = 0;
    
    if (route.includes('servers')) { targetX = 0; targetY = 0; targetZ = 800; }
    else if (route.includes('profile')) { targetX = -400; targetY = -200; targetZ = 500; }
    else if (route.includes('commands')) { targetX = 400; targetY = 200; targetZ = 500; }
    else if (route.includes('server/')) { targetX = 0; targetY = 100; targetZ = 300; }
    
    gsap.to(camera.position, {
        x: targetX,
        y: targetY,
        z: targetZ,
        duration: 1.2,
        ease: "power3.inOut"
    });
};

let lastFrameTime = performance.now();
let fpsAccumulator = 0;
let frames = 0;
let isDegraded = false;

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = now - lastFrameTime;
    lastFrameTime = now;
    
    // FPS Monitor & Graceful Degradation
    fpsAccumulator += delta;
    frames++;
    if (fpsAccumulator > 2000) {
        const fps = (frames * 1000) / fpsAccumulator;
        if (fps < 55 && !isDegraded) {
            console.warn(`[Spatial UI] Low framerate (${fps.toFixed(1)}fps). Degrading visuals.`);
            isDegraded = true;
            composer = null;
            renderer.setPixelRatio(1.0);
            if (particles) particles.count = Math.min(particles.count, 800);
        }
        fpsAccumulator = 0;
        frames = 0;
    }

    // Ease mouse
    mouse.lerp(targetMouse, 0.1);

    if (uniforms) {
        uniforms.uTime.value += 0.01;
        // Map normalized mouse to world space roughly for shader
        uniforms.uMouse.value.set(mouse.x * 1000, mouse.y * 1000, 0);
    }
    
    if (particles) {
        particles.rotation.y += 0.0003;
    }

    // Parallax camera sway
    camera.position.x += (mouse.x * 100 - camera.position.x) * 0.02;
    camera.position.y += (mouse.y * 100 - camera.position.y) * 0.02;
    camera.lookAt(scene.position);

    // Only burn GPU cycles if the canvas is actually visible
    const isVisible = document.body.style.background === 'transparent';
    if (isVisible) {
        if (composer) composer.render();
        else renderer.render(scene, camera);
    }
}
