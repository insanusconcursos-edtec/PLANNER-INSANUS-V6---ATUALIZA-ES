
import { UserLevel, Goal } from "./types";

export const ADMIN_EMAIL = "insanusconcursos@gmail.com";
export const ADMIN_PASS = "123456";

export const WEEKDAYS = [
  { key: 'domingo', label: 'Domingo' },
  { key: 'segunda', label: 'Segunda-feira' },
  { key: 'terca', label: 'Terça-feira' },
  { key: 'quarta', label: 'Quarta-feira' },
  { key: 'quinta', label: 'Quinta-feira' },
  { key: 'sexta', label: 'Sexta-feira' },
  { key: 'sabado', label: 'Sábado' },
];

export const calculateGoalDuration = (goal: Goal, level: UserLevel, semiActiveStudy: boolean = false): number => {
  if (!goal) return 0;

  let computedDuration = 0;

  if (goal.type === 'AULA') {
    // Sum of subgoals
    let baseDuration = goal.subGoals ? goal.subGoals.reduce((acc, sub) => acc + (sub.duration || 0), 0) : 0;
    // Fallback for Aula if empty
    if (baseDuration === 0) baseDuration = 30;

    // Apply Level Reduction (Speed watching)
    // Intermediário: 1.5x speed -> Reduces time needed by 25% (Prompt rule)
    // Avançado: 2.0x speed -> Reduces time needed by 50% (Prompt rule)
    let levelMultiplier = 1;
    if (level === 'intermediario') levelMultiplier = 0.75;
    else if (level === 'avancado') levelMultiplier = 0.50;

    computedDuration = baseDuration * levelMultiplier;

    // Apply Semi-active Study (Pausing for notes) -> x2 time
    if (semiActiveStudy) {
        computedDuration = computedDuration * 2;
    }

  } else if (goal.type === 'RESUMO' || goal.type === 'REVISAO') {
    computedDuration = goal.manualTime || 0;
  } else {
    // Page based calculation for MATERIAL, QUESTOES, LEI_SECA
    const pages = goal.pages || 0;
    let minutesPerPage = 0;

    if (goal.type === 'MATERIAL') {
      if (level === 'iniciante') minutesPerPage = 5;
      else if (level === 'intermediario') minutesPerPage = 3;
      else minutesPerPage = 1; // avancado
    } else if (goal.type === 'QUESTOES') {
      if (level === 'iniciante') minutesPerPage = 10;
      else if (level === 'intermediario') minutesPerPage = 6;
      else minutesPerPage = 2;
    } else if (goal.type === 'LEI_SECA') {
      if (level === 'iniciante') minutesPerPage = 5;
      else if (level === 'intermediario') minutesPerPage = 3;
      else minutesPerPage = 1;
      
      // Multiplier for Lei Seca
      if (goal.multiplier && goal.multiplier > 1) {
          minutesPerPage = minutesPerPage * goal.multiplier;
      }
    }

    computedDuration = pages * minutesPerPage;
  }

  // ROBUSTNESS FIX: Ensure non-zero duration for scheduler
  // If calculation is 0 (e.g. admin forgot pages), force a minimum so it appears in schedule
  if (computedDuration === 0 && goal.type !== 'AULA') {
      return 15; // Default safety duration
  }

  // Always ceiling to nearest integer minute to avoid floats
  return Math.ceil(isNaN(computedDuration) ? 15 : computedDuration);
};

// Helper for unique IDs
export const uuid = () => Date.now().toString(36) + Math.random().toString(36).substr(2);
