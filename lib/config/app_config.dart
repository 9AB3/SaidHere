class AppConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://saidhere.app',
  );
  static const appHost = String.fromEnvironment(
    'APP_HOST',
    defaultValue: 'saidhere.app',
  );
  static const googleMapsApiKey = String.fromEnvironment('GOOGLE_MAPS_API_KEY');
  static const demoTagToken = String.fromEnvironment('DEMO_TAG_TOKEN');

  static bool get isConfigured => apiBaseUrl.trim().isNotEmpty;
  static bool get hasGoogleMaps => googleMapsApiKey.trim().isNotEmpty;
}
