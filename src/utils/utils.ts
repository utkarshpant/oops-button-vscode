export function getGreetingByTimeOfDay() {
	const now = new Date();
	const currentHour = now.getHours();
	if (currentHour < 12) {
		return 'Good morning!';
	} else if (currentHour < 18) {
		return 'Good afternoon!';
	} else {
		return 'Good evening!';
	}
}