/*
 * Custom entry, existing for exactly one reason: the background-resume task.
 *
 * TaskManager tasks must be defined in the global scope of the bundle, because
 * a background launch "spins up your JavaScript app, runs your task and shuts
 * down — no views are mounted" (expo-task-manager docs). expo-router only
 * evaluates route modules (app/_layout.tsx included) when it RENDERS, so a
 * definition living there would not exist in a headless launch and the task
 * would fail with "task not found".
 *
 * Import order is load-bearing: the task module first, then the router entry.
 */
import './src/quiz/generation/backgroundResume';
import 'expo-router/entry';
