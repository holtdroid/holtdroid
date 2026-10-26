import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

public final class Geo {
    private static final String PACKAGE = "com.android.shell";

    public static void main(String[] args) throws Exception {
        Object service = Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "location");
        Object lm = Class.forName("android.location.ILocationManager$Stub")
                .getMethod("asInterface", Class.forName("android.os.IBinder"))
                .invoke(null, service);
        if (args[0].equals("remove")) {
            for (int i = 1; i < args.length; i++) {
                call(lm, "removeTestProvider", args[i], null, false, null);
            }
            return;
        }
        String[] at = args[1].split(",");
        for (int i = 2; i < args.length; i++) {
            String provider = args[i];
            try {
                call(lm, "addTestProvider", provider, properties(), false, null);
            } catch (Exception e) {
            }
            call(lm, "setTestProviderEnabled", provider, null, true, null);
            call(lm, "setTestProviderLocation", provider, null, false,
                    location(provider, Double.parseDouble(at[0]), Double.parseDouble(at[1])));
        }
    }

    private static void call(Object lm, String name, String provider, Object properties, boolean enabled, Object location) throws Exception {
        for (Method m : lm.getClass().getMethods()) {
            if (!m.getName().equals(name)) {
                continue;
            }
            Class<?>[] types = m.getParameterTypes();
            Object[] values = new Object[types.length];
            int strings = 0;
            for (int i = 0; i < types.length; i++) {
                if (types[i] == String.class) {
                    values[i] = strings == 0 ? provider : strings == 1 ? PACKAGE : null;
                    strings++;
                } else if (types[i] == boolean.class) {
                    values[i] = enabled;
                } else if (types[i].getName().equals("android.location.Location")) {
                    values[i] = location;
                } else {
                    values[i] = properties;
                }
            }
            m.invoke(lm, values);
            return;
        }
        throw new NoSuchMethodException(name);
    }

    private static Object properties() throws Exception {
        Class<?> type;
        try {
            type = Class.forName("android.location.provider.ProviderProperties");
        } catch (ClassNotFoundException e) {
            type = Class.forName("com.android.internal.location.ProviderProperties");
        }
        for (Constructor<?> c : type.getConstructors()) {
            Class<?>[] types = c.getParameterTypes();
            Object[] values = new Object[types.length];
            for (int i = 0; i < types.length; i++) {
                if (types[i] == boolean.class) {
                    values[i] = false;
                } else if (types[i] == int.class) {
                    values[i] = 1;
                } else {
                    break;
                }
            }
            if (values.length > 0 && values[values.length - 1] != null) {
                return c.newInstance(values);
            }
        }
        throw new NoSuchMethodException("ProviderProperties");
    }

    private static Object location(String provider, double latitude, double longitude) throws Exception {
        Class<?> c = Class.forName("android.location.Location");
        Object l = c.getConstructor(String.class).newInstance(provider);
        c.getMethod("setLatitude", double.class).invoke(l, latitude);
        c.getMethod("setLongitude", double.class).invoke(l, longitude);
        c.getMethod("setAccuracy", float.class).invoke(l, 5f);
        c.getMethod("setTime", long.class).invoke(l, System.currentTimeMillis());
        long nanos = (long) Class.forName("android.os.SystemClock").getMethod("elapsedRealtimeNanos").invoke(null);
        c.getMethod("setElapsedRealtimeNanos", long.class).invoke(l, nanos);
        return l;
    }
}
