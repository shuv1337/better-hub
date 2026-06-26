import { waitUntil } from "@vercel/functions";

export function runGithubBackgroundTask(task: Promise<unknown>): void {
	try {
		waitUntil(
			task.catch((error) => {
				console.error("[github] background task failed", error);
			}),
		);
	} catch {
		void task.catch((error) => {
			console.error("[github] background task failed", error);
		});
	}
}
