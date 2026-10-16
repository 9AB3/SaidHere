import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config/app_config.dart';
import 'screens/configuration_screen.dart';
import 'screens/discovered_walls_screen.dart';
import 'screens/home_screen.dart';
import 'screens/tag_entry_screen.dart';
import 'screens/wall_screen.dart';
import 'services/local_history_service.dart';
import 'services/said_here_service.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (AppConfig.isConfigured) {
    await Supabase.initialize(
      url: AppConfig.supabaseUrl,
      publishableKey: AppConfig.supabaseAnonKey,
    );
  }

  runApp(const SaidHereApp());
}

class SaidHereApp extends StatefulWidget {
  const SaidHereApp({super.key});

  @override
  State<SaidHereApp> createState() => _SaidHereAppState();
}

class _SaidHereAppState extends State<SaidHereApp> {
  GoRouter? _router;

  @override
  void initState() {
    super.initState();
    if (AppConfig.isConfigured) {
      final service = SaidHereService(Supabase.instance.client);
      final history = LocalHistoryService();

      _router = GoRouter(
        routes: [
          GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
          GoRoute(
            path: '/t/:token',
            builder: (_, state) => TagEntryScreen(
              tagToken: state.pathParameters['token']!,
              service: service,
              localHistory: history,
            ),
          ),
          GoRoute(
            path: '/w/:slug',
            builder: (_, state) => WallScreen(
              slug: state.pathParameters['slug']!,
              service: service,
              freshVisit: state.uri.queryParameters['fresh'] == '1',
            ),
          ),
          GoRoute(
            path: '/found',
            builder: (_, _) => DiscoveredWallsScreen(service: service),
          ),
        ],
        errorBuilder: (_, state) => Scaffold(
          body: Center(child: Text('That page does not exist.\n${state.uri}')),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!AppConfig.isConfigured) {
      return MaterialApp(
        title: 'SaidHere',
        debugShowCheckedModeBanner: false,
        theme: SaidHereTheme.light,
        home: const ConfigurationScreen(),
      );
    }

    return MaterialApp.router(
      title: 'SaidHere',
      debugShowCheckedModeBanner: false,
      theme: SaidHereTheme.light,
      routerConfig: _router!,
    );
  }
}
