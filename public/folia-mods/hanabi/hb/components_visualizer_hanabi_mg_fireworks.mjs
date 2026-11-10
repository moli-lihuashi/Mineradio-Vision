/* 移植自 Folia components/visualizer/hanabi/mg/fireworks.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { burstActive, drawBursts, drawLaunch, launchDemand, launchEnd, planBurst } from './components_visualizer_hanabi_mg_burstPlan.mjs';
const PLAN_CACHE_LIMIT = 160;
export const createFireworks = (pixi, textures, options)=>{
    const view = new pixi.Container({
        isRenderGroup: true
    });
    const unit = Math.min(options.width, options.height);
    const maxParticles = Math.max(0, Math.floor(options.maxParticles));
    const poolOf = (blendMode)=>{
        const layer = new pixi.Container();
        layer.blendMode = blendMode;
        view.addChild(layer);
        return {
            layer,
            sprites: [],
            used: 0,
            shown: 0
        };
    };
    const normal = poolOf('normal');
    const additive = poolOf('add');
    let used = 0;
    const plans = new Map();
    const active = [];
    const textureOf = {
        glow: textures.glow,
        dot: textures.dot,
        star4: textures.star4,
        streak: textures.streak,
        flash: textures.glow
    };
    const emit = (texture, x, y, width, height, rotation, alpha, tint)=>{
        if (used >= maxParticles) return false;
        const pool = texture === 'flash' ? additive : normal;
        let sprite = pool.sprites[pool.used];
        if (!sprite) {
            sprite = new pixi.Sprite(textures.glow);
            sprite.anchor.set(0.5);
            pool.layer.addChild(sprite);
            pool.sprites.push(sprite);
        }
        pool.used += 1;
        sprite.texture = textureOf[texture];
        sprite.visible = true;
        sprite.position.set(x, y);
        sprite.rotation = rotation;
        sprite.width = width;
        sprite.height = height;
        sprite.alpha = alpha > 1 ? 1 : alpha;
        sprite.tint = tint;
        used += 1;
        return true;
    };
    const planOf = (event)=>{
        let plan = plans.get(event);
        if (!plan) {
            plan = planBurst(event, options.palette, {
                unit,
                amount: options.amount
            });
            plans.set(event, plan);
        }
        return plan;
    };
    const hideRest = (pool)=>{
        for(let i = pool.used; i < pool.shown; i += 1)pool.sprites[i].visible = false;
        pool.shown = pool.used;
        pool.used = 0;
    };
    const update = (time, bursts, launches)=>{
        used = 0;
        active.length = 0;
        for (const event of bursts){
            if (time < event.at || time > event.at + event.spec.duration) continue;
            const plan = planOf(event);
            if (burstActive(plan, time)) active.push(plan);
        }
        if (plans.size > PLAN_CACHE_LIMIT) {
            const keep = new Set(active);
            for (const [event, plan] of plans)if (!keep.has(plan)) plans.delete(event);
        }
        let launchBudget = 0;
        for (const launch of launches){
            if (time < launch.at || time > launchEnd(launch)) continue;
            launchBudget += launchDemand(launch, time);
        }
        launchBudget = Math.min(launchBudget, Math.floor(maxParticles * 0.2));
        for (const launch of launches){
            if (used >= launchBudget) break;
            if (!drawLaunch(launch, time, unit, emit)) break;
        }
        drawBursts(active, time, maxParticles - used, emit);
        hideRest(normal);
        hideRest(additive);
        view.visible = used > 0;
    };
    return {
        view,
        update,
        destroy: ()=>{
            plans.clear();
            view.destroy({
                children: true
            });
        }
    };
};
