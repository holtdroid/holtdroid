import java.io.File;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public final class Clip {
    private static final String PACKAGE = "com.android.shell";
    private static final String SUPPRESS_OVERLAY = "com.android.systemui.SUPPRESS_CLIPBOARD_OVERLAY";

    public static void main(String[] args) throws Exception {
        File file = new File(args[0]);
        String text = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        file.delete();

        Class<?> clipData = Class.forName("android.content.ClipData");
        Object clip = clipData.getMethod("newPlainText", CharSequence.class, CharSequence.class).invoke(null, "", text);
        Object extras = Class.forName("android.os.PersistableBundle").getConstructor().newInstance();
        extras.getClass().getMethod("putBoolean", String.class, boolean.class).invoke(extras, SUPPRESS_OVERLAY, true);
        Object description = clipData.getMethod("getDescription").invoke(clip);
        description.getClass().getMethod("setExtras", extras.getClass()).invoke(description, extras);

        Object service = Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "clipboard");
        Object clipboard = Class.forName("android.content.IClipboard$Stub")
                .getMethod("asInterface", Class.forName("android.os.IBinder"))
                .invoke(null, service);
        for (Method m : clipboard.getClass().getMethods()) {
            if (!m.getName().equals("setPrimaryClip")) {
                continue;
            }
            Class<?>[] types = m.getParameterTypes();
            Object[] values = new Object[types.length];
            boolean pkg = false;
            for (int i = 0; i < types.length; i++) {
                if (types[i] == String.class && !pkg) {
                    values[i] = PACKAGE;
                    pkg = true;
                } else if (types[i] == int.class) {
                    values[i] = 0;
                } else if (types[i] == clipData) {
                    values[i] = clip;
                }
            }
            m.invoke(clipboard, values);
            return;
        }
        throw new NoSuchMethodException("setPrimaryClip");
    }
}
