import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;

public final class Mic {
    private static final int RATE = 48000;
    private static final int STEREO = 12;
    private static final int PCM_16BIT = 2;
    private static final int RULE_MATCH_ATTRIBUTE_CAPTURE_PRESET = 2;
    private static final int ROUTE_FLAG_LOOP_BACK = 2;
    private static final int[] PRESETS = {0, 1, 5, 6, 7, 9, 10};

    public static void main(String[] args) throws Exception {
        Class.forName("android.os.Looper").getMethod("prepareMainLooper").invoke(null);

        Class<?> formatBuilder = Class.forName("android.media.AudioFormat$Builder");
        Object format = formatBuilder.getConstructor().newInstance();
        formatBuilder.getMethod("setSampleRate", int.class).invoke(format, RATE);
        formatBuilder.getMethod("setChannelMask", int.class).invoke(format, STEREO);
        formatBuilder.getMethod("setEncoding", int.class).invoke(format, PCM_16BIT);
        format = formatBuilder.getMethod("build").invoke(format);

        Class<?> attrsBuilder = Class.forName("android.media.AudioAttributes$Builder");
        Class<?> ruleBuilder = Class.forName("android.media.audiopolicy.AudioMixingRule$Builder");
        Object rule = ruleBuilder.getConstructor().newInstance();
        for (int preset : PRESETS) {
            Object attrs = attrsBuilder.getConstructor().newInstance();
            attrsBuilder.getMethod("setCapturePreset", int.class).invoke(attrs, preset);
            attrs = attrsBuilder.getMethod("build").invoke(attrs);
            ruleBuilder.getMethod("addMixRule", int.class, Object.class).invoke(rule, RULE_MATCH_ATTRIBUTE_CAPTURE_PRESET, attrs);
        }
        rule = ruleBuilder.getMethod("build").invoke(rule);

        Class<?> mixClass = Class.forName("android.media.audiopolicy.AudioMix");
        Class<?> mixBuilder = Class.forName("android.media.audiopolicy.AudioMix$Builder");
        Object mix = mixBuilder.getConstructor(rule.getClass()).newInstance(rule);
        mixBuilder.getMethod("setFormat", format.getClass()).invoke(mix, format);
        mixBuilder.getMethod("setRouteFlags", int.class).invoke(mix, ROUTE_FLAG_LOOP_BACK);
        mix = mixBuilder.getMethod("build").invoke(mix);

        Class<?> context = Class.forName("android.content.Context");
        Class<?> policyBuilder = Class.forName("android.media.audiopolicy.AudioPolicy$Builder");
        Object policy = policyBuilder.getConstructor(context).newInstance((Object) null);
        policyBuilder.getMethod("addMix", mixClass).invoke(policy, mix);
        policy = policyBuilder.getMethod("build").invoke(policy);

        register(policy);
        Object track = policy.getClass().getMethod("createAudioTrackSource", mixClass).invoke(policy, mix);
        track.getClass().getMethod("play").invoke(track);

        Class<?> serverClass = Class.forName("android.net.LocalServerSocket");
        Object server = serverClass.getConstructor(String.class).newInstance(args[0]);
        Object socket = serverClass.getMethod("accept").invoke(server);
        InputStream in = (InputStream) socket.getClass().getMethod("getInputStream").invoke(socket);
        OutputStream out = (OutputStream) socket.getClass().getMethod("getOutputStream").invoke(socket);
        out.write(0);
        out.flush();

        Method write = track.getClass().getMethod("write", byte[].class, int.class, int.class);
        byte[] buf = new byte[RATE / 25 * 4];
        int have = 0;
        int n;
        while ((n = in.read(buf, have, buf.length - have)) > 0) {
            have += n;
            int frames = have & ~3;
            if (frames > 0) {
                write.invoke(track, buf, 0, frames);
                System.arraycopy(buf, frames, buf, 0, have - frames);
                have -= frames;
            }
        }
        System.exit(0);
    }

    private static void register(Object policy) throws Exception {
        Object binder = Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "audio");
        Object audio = Class.forName("android.media.IAudioService$Stub")
                .getMethod("asInterface", Class.forName("android.os.IBinder"))
                .invoke(null, binder);
        Object config = policy.getClass().getMethod("getConfig").invoke(policy);
        Object cb = policy.getClass().getMethod("cb").invoke(policy);
        for (Method m : audio.getClass().getMethods()) {
            if (!m.getName().equals("registerAudioPolicy")) {
                continue;
            }
            Class<?>[] types = m.getParameterTypes();
            Object[] values = new Object[types.length];
            for (int i = 0; i < types.length; i++) {
                if (types[i] == boolean.class) {
                    values[i] = false;
                } else if (types[i].isInstance(config)) {
                    values[i] = config;
                } else if (types[i].isInstance(cb)) {
                    values[i] = cb;
                } else if (types[i].getName().equals("android.content.AttributionSource")) {
                    values[i] = attribution();
                }
            }
            Object id = m.invoke(audio, values);
            if (id == null) {
                throw new IllegalStateException("registerAudioPolicy refused the policy");
            }
            policy.getClass().getMethod("setRegistration", String.class).invoke(policy, id);
            return;
        }
        throw new NoSuchMethodException("registerAudioPolicy");
    }

    private static Object attribution() throws Exception {
        Class<?> process = Class.forName("android.os.Process");
        Class<?> builder = Class.forName("android.content.AttributionSource$Builder");
        Object b = builder.getConstructor(int.class).newInstance((int) process.getMethod("myUid").invoke(null));
        builder.getMethod("setPid", int.class).invoke(b, (int) process.getMethod("myPid").invoke(null));
        return builder.getMethod("build").invoke(b);
    }
}
