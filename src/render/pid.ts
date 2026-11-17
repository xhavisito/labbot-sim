/**
 * Controlador PID con anti-windup (solo dibujo). Lo usa `RampSim` para que los rodillos de la rampa de Phoenix lleven
 * cada Muestra a su lugar como lo haría un motor real: fuerza acotada (límite del motor), integral que vence la
 * gravedad / inercia y no se acumula mientras el motor está saturado (SUPUESTO de diseño: el manual no habla de esto).
 * El término derivativo se calcula sobre la velocidad medida (sin "patada" cuando cambia la meta).
 */
export class Pid {
  private integral = 0;

  constructor(
    public kp: number,
    public ki: number,
    public kd: number,
    /** Salida máxima (en valor absoluto); también acota la integral. */
    public limit = Infinity,
    /** Zona de integración: solo integra con |error| menor a esto (evita que se cargue de integral en un recorrido largo y rebase la meta). */
    public iZone = Infinity,
  ) {}

  reset(): void {
    this.integral = 0;
  }

  /** `error` = meta − medida; `vel` = velocidad medida. Devuelve la salida acotada. */
  update(error: number, vel: number, dt: number): number {
    const raw = this.kp * error + this.ki * this.integral - this.kd * vel;
    const out = Math.max(-this.limit, Math.min(this.limit, raw));
    // Anti-windup: solo integra si no está saturado, o si el error ayuda a salir de la saturación
    if (Math.abs(error) > this.iZone) this.integral = 0;
    else if (out === raw || Math.sign(error) !== Math.sign(raw)) {
      const cap = this.ki > 0 ? this.limit / this.ki : 0;
      this.integral = Math.max(-cap, Math.min(cap, this.integral + error * dt));
    }
    return out;
  }
}
