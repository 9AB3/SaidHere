import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../services/local_history_service.dart';
import '../services/said_here_service.dart';
import '../theme/app_theme.dart';
import '../widgets/wall_background.dart';

class FirstScanSetupScreen extends StatefulWidget {
  const FirstScanSetupScreen({
    required this.tagToken,
    required this.service,
    required this.localHistory,
    super.key,
  });

  final String tagToken;
  final SaidHereService service;
  final LocalHistoryService localHistory;

  @override
  State<FirstScanSetupScreen> createState() => _FirstScanSetupScreenState();
}

class _FirstScanSetupScreenState extends State<FirstScanSetupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _location = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();

  FirstScanSetup? _setup;
  String? _error;
  bool _loading = true;
  bool _saving = false;
  bool _hidePassword = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _location.dispose();
    _email.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final setup = await widget.service.getFirstScanSetup(widget.tagToken);
      if (!mounted) return;
      if (!setup.setupRequired) {
        final wall = await widget.service.claimWallVisit(widget.tagToken);
        await widget.localHistory.rememberWall(
          slug: wall.slug,
          displayName: wall.displayName,
          locationHint: wall.locationHint,
        );
        if (!mounted) return;
        context.go('/w/${wall.slug}?fresh=1');
        return;
      }
      setState(() {
        _setup = setup;
        _loading = false;
      });
    } on SaidHereException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _submit() async {
    if (_saving || !_formKey.currentState!.validate()) return;
    final setup = _setup;
    if (setup == null) return;
    if (!setup.accountActive && _password.text != _confirmPassword.text) {
      setState(() => _error = 'The passwords do not match.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final wall = await widget.service.completeFirstScanSetup(
        tagToken: widget.tagToken,
        displayName: _name.text,
        locationHint: _location.text,
        email: _email.text,
        password: _password.text,
      );
      await widget.localHistory.rememberWall(
        slug: wall.slug,
        displayName: wall.displayName,
        locationHint: wall.locationHint,
      );
      if (!mounted) return;
      context.go('/w/${wall.slug}?fresh=1');
    } on SaidHereException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.toString();
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.toString();
      });
    }
  }

  InputDecoration _decoration(String label, {String? hint, Widget? suffix}) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      suffixIcon: suffix,
      filled: true,
      fillColor: const Color(0xFFF7F0E4),
      border: const OutlineInputBorder(),
      enabledBorder: const OutlineInputBorder(
        borderSide: BorderSide(color: Color(0xFF8B8174)),
      ),
      focusedBorder: const OutlineInputBorder(
        borderSide: BorderSide(color: SaidHereTheme.ink, width: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final setup = _setup;
    return Scaffold(
      body: WallBackground(
        heavy: true,
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(22, 24, 22, 24),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE9DDC9),
                    border: Border.all(color: const Color(0xFF8B8174)),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x44000000),
                        offset: Offset(4, 5),
                        blurRadius: 0,
                      ),
                    ],
                  ),
                  child: _loading
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: 56),
                          child: Column(
                            children: [
                              CircularProgressIndicator(color: SaidHereTheme.ink),
                              SizedBox(height: 18),
                              Text(
                                'CHECKING THIS WALL…',
                                style: TextStyle(fontWeight: FontWeight.w900),
                              ),
                            ],
                          ),
                        )
                      : setup == null
                          ? Column(
                              children: [
                                const Text(
                                  'COULD NOT SET UP THIS WALL',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  _error ?? 'Try scanning the Wall again.',
                                  textAlign: TextAlign.center,
                                ),
                                const SizedBox(height: 18),
                                FilledButton(
                                  onPressed: () {
                                    setState(() {
                                      _loading = true;
                                      _error = null;
                                    });
                                    _load();
                                  },
                                  child: const Text('TRY AGAIN'),
                                ),
                              ],
                            )
                          : Form(
                              key: _formKey,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  const Icon(Icons.nfc, size: 48),
                                  const SizedBox(height: 10),
                                  const Text(
                                    'SET UP YOUR WALL',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 28,
                                      height: 1,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: -.8,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  const Text(
                                    'This is the first physical scan. Name the Wall, set its location, then start posting immediately.',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(height: 1.4),
                                  ),
                                  if (setup.serialCode != null && setup.serialCode!.isNotEmpty) ...[
                                    const SizedBox(height: 10),
                                    Text(
                                      'WALL ${setup.serialCode}',
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w900,
                                        letterSpacing: 1,
                                      ),
                                    ),
                                  ],
                                  const SizedBox(height: 24),
                                  TextFormField(
                                    controller: _name,
                                    textInputAction: TextInputAction.next,
                                    maxLength: 80,
                                    decoration: _decoration(
                                      'Wall name',
                                      hint: "The Royal Hotel — Men's Bathroom",
                                    ),
                                    validator: (value) => (value ?? '').trim().isEmpty
                                        ? 'Enter a Wall name.'
                                        : null,
                                  ),
                                  const SizedBox(height: 10),
                                  TextFormField(
                                    controller: _location,
                                    textInputAction: TextInputAction.next,
                                    maxLength: 120,
                                    decoration: _decoration(
                                      'Location',
                                      hint: 'Singleton NSW',
                                    ),
                                    validator: (value) => (value ?? '').trim().isEmpty
                                        ? 'Enter the Wall location.'
                                        : null,
                                  ),
                                  const SizedBox(height: 10),
                                  TextFormField(
                                    controller: _email,
                                    keyboardType: TextInputType.emailAddress,
                                    textInputAction: TextInputAction.next,
                                    autofillHints: const [AutofillHints.email],
                                    decoration: _decoration('Purchase email'),
                                    validator: (value) {
                                      final email = (value ?? '').trim();
                                      if (!email.contains('@')) {
                                        return 'Enter the email used to purchase this Wall.';
                                      }
                                      return null;
                                    },
                                  ),
                                  const SizedBox(height: 10),
                                  TextFormField(
                                    controller: _password,
                                    obscureText: _hidePassword,
                                    textInputAction: setup.accountActive
                                        ? TextInputAction.done
                                        : TextInputAction.next,
                                    autofillHints: [
                                      setup.accountActive
                                          ? AutofillHints.password
                                          : AutofillHints.newPassword,
                                    ],
                                    decoration: _decoration(
                                      setup.accountActive
                                          ? 'Owner account password'
                                          : 'Create owner password',
                                      suffix: IconButton(
                                        onPressed: () => setState(
                                          () => _hidePassword = !_hidePassword,
                                        ),
                                        icon: Icon(
                                          _hidePassword
                                              ? Icons.visibility_outlined
                                              : Icons.visibility_off_outlined,
                                        ),
                                      ),
                                    ),
                                    validator: (value) => (value ?? '').length < 8
                                        ? 'Password must be at least 8 characters.'
                                        : null,
                                    onFieldSubmitted: setup.accountActive ? (_) => _submit() : null,
                                  ),
                                  if (!setup.accountActive) ...[
                                    const SizedBox(height: 10),
                                    TextFormField(
                                      controller: _confirmPassword,
                                      obscureText: _hidePassword,
                                      textInputAction: TextInputAction.done,
                                      autofillHints: const [AutofillHints.newPassword],
                                      decoration: _decoration('Confirm password'),
                                      validator: (value) => (value ?? '').length < 8
                                          ? 'Confirm your password.'
                                          : null,
                                      onFieldSubmitted: (_) => _submit(),
                                    ),
                                  ],
                                  const SizedBox(height: 8),
                                  Text(
                                    setup.accountActive
                                        ? 'Enter the password for the owner account linked to this purchase.'
                                        : 'This first scan also activates your owner account. You can use it later to manage this Wall.',
                                    style: const TextStyle(fontSize: 12, height: 1.4),
                                  ),
                                  if (_error != null) ...[
                                    const SizedBox(height: 14),
                                    Container(
                                      padding: const EdgeInsets.all(12),
                                      color: const Color(0xFFF0D8D3),
                                      child: Text(
                                        _error!,
                                        style: const TextStyle(
                                          color: Color(0xFF7C342F),
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                  ],
                                  const SizedBox(height: 18),
                                  FilledButton.icon(
                                    onPressed: _saving ? null : _submit,
                                    icon: _saving
                                        ? const SizedBox(
                                            width: 18,
                                            height: 18,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              color: Colors.white,
                                            ),
                                          )
                                        : const Icon(Icons.arrow_forward),
                                    label: Text(
                                      _saving ? 'SETTING UP…' : 'FINISH SETUP & OPEN WALL',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
